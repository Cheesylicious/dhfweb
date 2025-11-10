# database/db_admin.py
from datetime import datetime
# --- ANGEPASSTE IMPORTE ---
from .db_core import create_connection, hash_password, _create_admin_notification, get_vacation_days_for_tenure, \
    _log_activity
from .db_connection import DB_CONFIG  # <-- NEUER IMPORT FÜR ZUGANGSDATEN
# --- ENDE ANPASSUNG ---
import mysql.connector
import subprocess  # <-- NEUER IMPORT
import shutil      # <-- NEUER IMPORT
import os          # <-- NEUER IMPORT


# --- (Alle anderen Funktionen in dieser Datei bleiben unverändert) ---
def lock_month(year, month):
    conn = create_connection()
    if conn is None: return False
    try:
        cursor = conn.cursor()
        # Annahme: 'locked_months' Tabelle existiert (wurde in initialize_db nicht gezeigt)
        cursor.execute("INSERT IGNORE INTO locked_months (year, month) VALUES (%s, %s)", (year, month))
        conn.commit()
        return True
    except mysql.connector.Error as e:
        if e.errno == 1146:
            print("FEHLER: Tabelle 'locked_months' existiert nicht.")
        else:
            print(f"DB Error on lock_month: {e}")
        return False
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def unlock_month(year, month):
    conn = create_connection()
    if conn is None: return False
    try:
        cursor = conn.cursor()
        # Annahme: 'locked_months' Tabelle existiert
        cursor.execute("DELETE FROM locked_months WHERE year = %s AND month = %s", (year, month))
        conn.commit()
        return True
    except mysql.connector.Error as e:
        if e.errno == 1146:
            print("FEHLER: Tabelle 'locked_months' existiert nicht.")
        else:
            print(f"DB Error on unlock_month: {e}")
        return False
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def is_month_locked(year, month):
    conn = create_connection()
    if conn is None: return False
    try:
        cursor = conn.cursor()
        # Annahme: 'locked_months' Tabelle existiert
        cursor.execute("SELECT 1 FROM locked_months WHERE year = %s AND month = %s", (year, month))
        return cursor.fetchone() is not None
    except mysql.connector.Error as e:
        if e.errno == 1146:
            print("FEHLER: Tabelle 'locked_months' existiert nicht.")
            return False
        print(f"DB Error on is_month_locked: {e}")
        return False
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def admin_reset_password(user_id, new_password, admin_id):
    conn = create_connection()
    if conn is None: return False, "Keine Datenbankverbindung."
    try:
        cursor = conn.cursor()

        cursor.execute("SELECT vorname, name FROM users WHERE id = %s", (user_id,))
        user_data = cursor.fetchone()
        user_fullname = f"{user_data[0]} {user_data[1]}" if user_data else f"ID {user_id}"

        cursor.execute(
            "UPDATE users SET password_hash = %s, password_changed = 0 WHERE id = %s",
            (hash_password(new_password), user_id)
        )

        _log_activity(cursor, admin_id, 'USER_PASSWORD_RESET',
                      f'Passwort von Benutzer {user_fullname} (ID: {user_id}) wurde durch Admin {admin_id} zurückgesetzt.')

        conn.commit()
        return True, f"Passwort für {user_fullname} wurde zurückgesetzt. Der Benutzer muss es beim nächsten Login ändern."
    except mysql.connector.Error as e:
        conn.rollback()
        return False, f"Datenbankfehler: {e}"
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def get_unread_admin_notifications():
    conn = create_connection()
    if conn is None: return []
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, message FROM admin_notifications WHERE is_read = 0 ORDER BY timestamp ASC")
        return cursor.fetchall()
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def mark_admin_notifications_as_read(notification_ids):
    if not notification_ids:
        return
    conn = create_connection()
    if conn is None: return
    try:
        cursor = conn.cursor()
        placeholders = ', '.join(['%s'] * len(notification_ids))
        query = f"UPDATE admin_notifications SET is_read = 1 WHERE id IN ({placeholders})"
        cursor.execute(query, tuple(notification_ids))
        conn.commit()
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


# --- HIER IST DIE KORRIGIERTE FUNKTION ---
def create_user_by_admin(data, admin_id):
    """
    Erstellt einen neuen Benutzer durch einen Admin, setzt is_approved=1 und
    führt die Urlaubsanspruchsberechnung durch.
    """
    conn = create_connection()
    if conn is None:
        return False, "Keine Datenbankverbindung."
    try:
        cursor = conn.cursor()

        # --- URLAUBSBERECHNUNG ---
        entry_date_str = data.get('entry_date')
        default_days = 30
        try:
            default_days = int(data.get('urlaub_gesamt', 30))
        except (ValueError, TypeError):
            default_days = 30

        urlaub_gesamt = get_vacation_days_for_tenure(entry_date_str, default_days)
        # --- ENDE URLAUBSBERECHNUNG ---

        user_fullname = f"{data['vorname']} {data['name']}"

        # Erweitertes INSERT-Statement zur Aufnahme aller benötigten Felder inkl. Status-Flags
        cursor.execute(
            """INSERT INTO users (vorname, name, password_hash, role, geburtstag, telefon, diensthund,
                                  urlaub_gesamt, urlaub_rest, entry_date, is_approved, is_archived,
                                  password_changed, has_seen_tutorial)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (data['vorname'], data['name'], hash_password(data['password']), data['role'],
             data.get('geburtstag', None), data.get('telefon', None), data.get('diensthund', None),
             urlaub_gesamt, urlaub_gesamt, entry_date_str,
             1, 0,  # is_approved=1, is_archived=0 (Benutzer ist freigeschaltet und aktiv)
             data.get('password_changed', 0),  # Aus GUI-Daten
             data.get('has_seen_tutorial', 0))  # Aus GUI-Daten
        )

        user_id = cursor.lastrowid

        _log_activity(cursor, admin_id, 'USER_CREATION',
                      f'Benutzer {user_fullname} (ID: {user_id}) wurde durch Admin {admin_id} erstellt.')
        _create_admin_notification(cursor, f"Neuer Benutzer {user_fullname} wurde durch Admin {admin_id} angelegt.")

        conn.commit()
        return True, f"Mitarbeiter {user_fullname} erfolgreich hinzugefügt und freigeschaltet."
    except mysql.connector.IntegrityError:
        conn.rollback()
        return False, "Ein Mitarbeiter mit diesem Namen existiert bereits."
    except Exception as e:
        conn.rollback()
        print(f"Error in create_user_by_admin: {e}")
        return False, f"Ein unerwarteter Datenbankfehler ist aufgetreten: {e}"
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def request_password_reset(vorname, name):
    conn = create_connection()
    if conn is None: return False, "Keine Datenbankverbindung."
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id FROM users WHERE lower(vorname) = %s AND lower(name) = %s",
                       (vorname.lower(), name.lower()))
        user = cursor.fetchone()
        if user:
            user_id = user['id']
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            cursor.execute(
                "INSERT INTO password_reset_requests (user_id, token, timestamp) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE token=VALUES(token), timestamp=VALUES(timestamp)",
                (user_id, 'dummy_token', timestamp)
                # Token wird nicht wirklich verwendet, aber Feld muss gefüllt sein (basierend auf DB-Schema)
            )
            _create_admin_notification(cursor, f"Benutzer {vorname} {name} hat ein Passwort-Reset angefordert.")
            conn.commit()
            return True, "Ihre Anfrage wurde an einen Administrator gesendet."
        else:
            return False, "Benutzer nicht gefunden."
    except mysql.connector.Error as e:
        if e.errno == 1062:  # Duplicate entry for user_id (UNIQUE constraint)
            # Dies ist OK, bedeutet, dass schon eine Anfrage besteht.
            _create_admin_notification(cursor, f"Benutzer {vorname} {name} hat ERNEUT ein Passwort-Reset angefordert.")
            conn.commit()
            return True, "Eine Anfrage für diesen Benutzer existiert bereits und wurde erneut an einen Admin gemeldet."
        print(f"DB Error on request_password_reset: {e}")
        return False, f"Datenbankfehler: {e}"
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def get_pending_password_resets():
    conn = create_connection()
    if conn is None: return []
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
                       SELECT pr.id, u.vorname, u.name, pr.timestamp, u.id as user_id
                       FROM password_reset_requests pr
                                JOIN users u ON pr.user_id = u.id
                       ORDER BY pr.timestamp ASC
                       """)
        # Filterung auf 'Ausstehend' entfernt, da das Schema (aus db_core) keine 'status' Spalte hat
        return cursor.fetchall()
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def approve_password_reset(request_id, new_password):
    conn = create_connection()
    if conn is None: return False, "Keine Datenbankverbindung."
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT user_id FROM password_reset_requests WHERE id = %s", (request_id,))
        result = cursor.fetchone()
        if result:
            user_id = result['user_id']
            cursor.execute(
                "UPDATE users SET password_hash = %s, password_changed = 0 WHERE id = %s",
                (hash_password(new_password), user_id)
            )
            # Anfrage löschen, da sie bearbeitet wurde
            cursor.execute("DELETE FROM password_reset_requests WHERE id = %s", (request_id,))
            conn.commit()
            return True, f"Passwort für Benutzer ID {user_id} wurde zurückgesetzt."
        return False, "Anfrage nicht gefunden."
    except mysql.connector.Error as e:
        return False, f"Datenbankfehler: {e}"
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def reject_password_reset(request_id):
    conn = create_connection()
    if conn is None: return False, "Keine Datenbankverbindung."
    try:
        cursor = conn.cursor()
        # Anfrage löschen, da sie bearbeitet (abgelehnt) wurde
        cursor.execute("DELETE FROM password_reset_requests WHERE id = %s", (request_id,))
        conn.commit()
        return True, "Anfrage abgelehnt und entfernt."
    except mysql.connector.Error as e:
        return False, f"Datenbankfehler: {e}"
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


def get_pending_password_resets_count():
    conn = create_connection()
    if conn is None: return 0
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM password_reset_requests")
        # Filterung auf 'Ausstehend' entfernt
        return cursor.fetchone()[0]
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()


# --- INNOVATION: NEUE FUNKTION FÜR DATENBANK-BACKUP ---
def create_database_backup(target_filepath):
    """
    Erstellt ein Backup der MySQL-Datenbank mittels 'mysqldump'.
    Voraussetzung: 'mysqldump' muss im Systempfad (PATH) des ausführenden
    Computers (des Admins) installiert sein.
    """
    if DB_CONFIG is None:
        return False, "Datenbank-Konfiguration (DB_CONFIG) ist nicht geladen."

    # 1. Prüfen, ob mysqldump überhaupt verfügbar ist
    if shutil.which("mysqldump") is None:
        msg = "FEHLER: 'mysqldump' konnte nicht im Systempfad gefunden werden.\n\n" \
              "Stellen Sie sicher, dass die MySQL-Client-Tools (oder Server-Tools) " \
              "installiert und 'mysqldump' über die Kommandozeile erreichbar ist."
        print(msg)
        return False, msg

    # 2. Konfigurationsdaten holen
    try:
        host = DB_CONFIG['host']
        user = DB_CONFIG['user']
        password = DB_CONFIG['password']
        database = DB_CONFIG['database']
        # Port ist oft optional, aber gut, ihn zu haben
        port = str(DB_CONFIG.get('port', 3306))
    except KeyError as e:
        return False, f"Fehlender Schlüssel in DB_CONFIG: {e}"

    # 3. mysqldump-Befehl sicher erstellen
    # --- KORREKTUR: Das Flag '--database' wurde entfernt ---
    # Der Datenbankname wird stattdessen als letztes Argument übergeben.
    command = [
        "mysqldump",
        "--host", host,
        "--port", port,
        "--user", user,
        # "--database", database,  # <-- DIESE ZEILE WAR FEHLERHAFT
        "--routines",  # Auch Prozeduren/Funktionen sichern
        "--triggers",  # Trigger sichern
        "--single-transaction",  # Sorgt für konsistenten Snapshot bei InnoDB
        "--result-file", target_filepath,
        database  # <-- Datenbankname als Positionsargument
    ]
    # --- ENDE KORREKTUR ---

    # 4. Passwort sicher über Umgebungsvariable übergeben
    # (Sicherer als im Befehls-String)
    env = os.environ.copy()
    env['MYSQL_PWD'] = password

    try:
        print(f"Führe mysqldump aus... Ziel: {target_filepath}")

        # Führe den Befehl aus
        process = subprocess.run(
            command,
            env=env,
            capture_output=True,  # stdout/stderr auffangen
            text=True,
            check=False,  # Bei Fehler selbst abfangen
            encoding='utf-8' # Explizite Kodierung für stderr
        )

        # 5. Ergebnis prüfen
        if process.returncode == 0:
            print("mysqldump erfolgreich.")
            if not os.path.exists(target_filepath) or os.path.getsize(target_filepath) == 0:
                 # Manchmal gibt mysqldump 0 zurück, schreibt aber nichts (z.B. --single-transaction auf MyISAM)
                 error_msg = f"mysqldump-Prozess war erfolgreich (Code 0), aber die Zieldatei '{target_filepath}' ist leer oder fehlt."
                 if process.stderr:
                     error_msg += f"\n\nFehlermeldung (stderr):\n{process.stderr}"
                 print(error_msg)
                 return False, error_msg
            return True, "Datenbank-Backup erfolgreich erstellt."
        else:
            # Fehler aufgetreten
            error_msg = f"mysqldump fehlgeschlagen (Code {process.returncode}):\n{process.stderr}"
            print(error_msg)
            # Sicherstellen, dass keine unvollständige Datei bleibt
            if os.path.exists(target_filepath):
                try:
                    os.remove(target_filepath)
                except Exception as e_del:
                    print(f"Konnte unvollständige Backupdatei nicht löschen: {e_del}")
            return False, error_msg

    except Exception as e:
        error_msg = f"Ein unerwarteter Fehler beim Ausführen von subprocess ist aufgetreten: {e}"
        print(error_msg)
        if os.path.exists(target_filepath):
            try:
                os.remove(target_filepath)
            except Exception as e_del:
                 print(f"Konnte unvollständige Backupdatei (Exception) nicht löschen: {e_del}")
        return False, error_msg
# --- ENDE INNOVATION ---