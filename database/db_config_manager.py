# database/db_config_manager.py
import json
import threading
from .db_core import create_connection
import mysql.connector

# Cache für Konfigurationen
_config_cache = {}
_cache_lock = threading.Lock()


def clear_config_cache():
    """Leert den Konfigurations-Cache."""
    with _cache_lock:
        _config_cache.clear()
    print("[ConfigManager] Cache geleert.")


def load_config_json(config_key, use_cache=True):
    """
    Lädt eine Konfiguration (als JSON-String) aus der Datenbank.

    KORRIGIERT: Verwendet 'app_config' und 'config_value' gemäß db_schema.py.
    """
    if use_cache:
        with _cache_lock:
            cached_value = _config_cache.get(config_key)
            if cached_value:
                return cached_value

    conn = None
    try:
        conn = create_connection()
        if conn is None:
            raise ConnectionError("DB-Verbindung für Config-Laden fehlgeschlagen")

        cursor = conn.cursor()

        # --- KORREKTUR HIER ---
        query = "SELECT config_value FROM app_config WHERE config_key = %s"
        # --- ENDE KORREKTUR ---

        cursor.execute(query, (config_key,))
        result = cursor.fetchone()

        if result:
            config_json = result[0]
            if use_cache:
                with _cache_lock:
                    _config_cache[config_key] = config_json
            return config_json
        else:
            return None  # Kein Eintrag gefunden

    except mysql.connector.Error as db_err:
        print(f"DB Error on load_config_json ({config_key}): {db_err}")
        return None
    except Exception as e:
        print(f"General Error on load_config_json ({config_key}): {e}")
        return None
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def save_config_json(config_key, config_data):
    """
    Speichert Konfigurationsdaten (als Python-Dict) in der Datenbank.

    KORRIGIERT: Verwendet 'app_config' und 'config_value' gemäß db_schema.py.
    """
    conn = None
    try:
        config_json = json.dumps(config_data, indent=4)

        conn = create_connection()
        if conn is None:
            raise ConnectionError("DB-Verbindung für Config-Speichern fehlgeschlagen")

        cursor = conn.cursor()

        # --- KORREKTUR HIER ---
        query = """
            INSERT INTO app_config (config_key, config_value)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
        """
        # --- ENDE KORREKTUR ---

        cursor.execute(query, (config_key, config_json))
        conn.commit()

        # Cache nach dem Speichern aktualisieren
        with _cache_lock:
            _config_cache[config_key] = config_json

        return True, "Konfiguration erfolgreich gespeichert."

    except mysql.connector.Error as db_err:
        if conn: conn.rollback()
        print(f"DB Error on save_config_json ({config_key}): {db_err}")
        return False, f"DB-Fehler: {db_err}"
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error on save_config_json ({config_key}): {e}")
        return False, f"Allgemeiner Fehler: {e}"
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()