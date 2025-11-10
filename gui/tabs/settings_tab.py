# gui/tabs/settings_tab.py
import tkinter as tk
# --- ANGEPASSTE IMPORTE ---
from tkinter import ttk, messagebox, simpledialog, filedialog
import threading  # <-- NEUER IMPORT
import os         # <-- NEUER IMPORT
from datetime import datetime # <-- NEUER IMPORT
# --- ENDE IMPORTE ---

from database.db_core import (
    run_db_update_v1, run_db_update_is_approved,
    load_config_json, save_config_json, VACATION_RULES_CONFIG_KEY,
    run_db_update_activation_date,

    # --- NEUE IMPORTE FÜR ROLLEN-MIGRATIONEN (Regel 4) ---
    run_db_migration_add_role_permissions,
    run_db_migration_add_role_window_type,

    # --- INNOVATION (Regel 2 & 4): Import für Farb-Migration ---
    run_db_migration_add_role_color
    # --- ENDE INNOVATION ---
)
from database.db_users import admin_batch_update_vacation_entitlements
# --- NEUER IMPORT FÜR BACKUP ---
from database.db_admin import create_database_backup
# --- ENDE NEU ---

# --- NEU (Regel 4): Import des neuen Konfigurations-Tabs ---
try:
    from ..dialogs.settings_tabs.window_config_tab import WindowConfigTab
except ImportError:
    print("[FEHLER] SettingsTab: Konnte WindowConfigTab nicht importieren.")


    # (Regel 1) Fallback-Klasse, falls Import fehlschlägt
    class WindowConfigTab(ttk.Frame):
        def __init__(self, master, **kwargs):
            super().__init__(master, **kwargs)
            ttk.Label(self, text="Fehler: window_config_tab.py konnte nicht geladen werden.", foreground="red").pack(
                padx=20, pady=20)


# --- ENDE NEU ---


class SettingsTab(ttk.Frame):
    def __init__(self, master, session_user):  # Session-User wird benötigt
        super().__init__(master)
        # --- NEU: Session-User speichern ---
        self.session_user = session_user
        self.vacation_rules = []  # Cache für die Regeln
        # --- ENDE NEU ---

        # --- KORREKTUR (Regel 4): UI wird jetzt in einem Notebook erstellt ---
        self.setup_notebook_ui()
        # (self.load_rules_data() wird jetzt von setup_notebook_ui aufgerufen)
        # --- ENDE KORREKTUR ---

    # --- KORREKTUR (Regel 4): Umbau zu Notebook-Struktur ---
    def setup_notebook_ui(self):
        """Erstellt ein Notebook für die verschiedenen Einstellungs-Bereiche."""

        # Haupt-Notebook
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=10)

        # --- 1. Tab: DB-Wartung (Der bisherige 'general_frame') ---
        # (Regel 4) Erstelle einen Frame für den ersten Tab
        db_wartung_frame = ttk.Frame(self.notebook, padding=(10, 20))
        self.notebook.add(db_wartung_frame, text="Datenbank-Wartung")

        # (Code aus altem setup_ui() hierher verschoben)
        general_frame = ttk.LabelFrame(db_wartung_frame, text="🛠️ Datenbank-Wartung und Updates", padding=(20, 10))
        general_frame.pack(fill="x", padx=10, pady=10, anchor='n')

        # --- 0. NEU: Migration für Rollen-Fenstertyp ---
        ttk.Label(general_frame,
                  text="Funktion für Rollen-Fensterzuweisung hinzufügen:",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="DB Update: 'Rollen-Fenstertyp' Spalte hinzufügen",
                   command=self.run_role_window_type_migration,
                   style='Success.TButton').pack(fill='x', padx=5, pady=5)
        # --- ENDE NEU ---

        # --- 1. NEU: Migration für Rollen-Berechtigungen ---
        ttk.Label(general_frame,
                  text="Funktion für Rollen-Berechtigungen & Hierarchie hinzufügen:",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="DB Update: 'Rollen-Berechtigungen' Spalten hinzufügen",
                   command=self.run_role_migration,
                   style='Success.TButton').pack(fill='x', padx=5, pady=5)
        # --- ENDE NEU ---

        # --- INNOVATION (Regel 2 & 4): Button für Rollen-Farben ---
        ttk.Label(general_frame,
                  text="Funktion für Rollen-Farben hinzufügen:",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="DB Update: 'Rollen-Farbe' (color_hex) Spalte hinzufügen",
                   command=self.run_role_color_migration,  # NEUE FUNKTION
                   style='Info.TButton').pack(fill='x', padx=5, pady=5)
        # --- ENDE INNOVATION ---

        # Separator
        ttk.Separator(general_frame, orient='horizontal').pack(fill='x', pady=15)

        # --- 2. Update für 'is_approved' Spalte (Fehlerbehebung) ---
        ttk.Label(general_frame,
                  text="Fehler 'Unknown column is_approved' bei Registrierung beheben:",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="DB Update: Benutzer-Freischaltung Spalte hinzufügen",
                   command=self.run_update_is_approved,
                   style='Danger.TButton').pack(fill='x', padx=5, pady=5)

        # --- 3. Update für 'activation_date' Spalte ---
        ttk.Label(general_frame,
                  text="Funktion für zukünftige Mitarbeiter-Aktivierung hinzufügen:",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="DB Update: 'Aktivierungsdatum' Spalte hinzufügen",
                   command=self.run_update_activation_date,
                   style='Danger.TButton').pack(fill='x', padx=5, pady=5)
        # --- ENDE NEU ---

        # Separator
        ttk.Separator(general_frame, orient='horizontal').pack(fill='x', pady=15)

        # --- 4. Update für Chat (Bestehende Funktion) ---
        ttk.Label(general_frame,
                  text="Datenbank-Update für die Chat-Funktion (last_seen und chat_messages):",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="DB Update: Chat-Funktion aktivieren/reparieren",
                   command=self.run_chat_update,
                   style='Success.TButton').pack(fill='x', padx=5, pady=5)

        # --- 5. INNOVATION: DATENBANK-BACKUP ---
        ttk.Separator(general_frame, orient='horizontal').pack(fill='x', pady=15)

        ttk.Label(general_frame,
                  text="Datenbank-Backup (Export für Web-Server):",
                  font=('Segoe UI', 10, 'bold')).pack(anchor='w', pady=(10, 5))

        ttk.Button(general_frame,
                   text="Datenbank-Backup (.sql) erstellen...",
                   command=self.run_create_backup,  # <-- NEUE HANDLER-METHODE
                   style='Accent.TButton').pack(fill='x', padx=5, pady=5)
        # --- ENDE INNOVATION ---


        # --- 2. Tab: Urlaubsregeln (Der bisherige 'vacation_frame') ---
        # (Regel 4) Erstelle einen Frame für den zweiten Tab
        urlaubs_frame = ttk.Frame(self.notebook, padding=(10, 20))
        self.notebook.add(urlaubs_frame, text="Urlaubsregeln")

        # (Code aus altem setup_ui() hierher verschoben)
        vacation_frame = ttk.LabelFrame(urlaubs_frame, text="📅 Urlaubsanspruch nach Dienstjahren", padding=(20, 10))
        vacation_frame.pack(fill="both", expand=True, padx=10, pady=10)

        vacation_frame.columnconfigure(0, weight=1)
        vacation_frame.rowconfigure(0, weight=1)

        # Treeview zur Anzeige der Regeln
        self.rules_tree = ttk.Treeview(vacation_frame, columns=("years", "days"), show="headings")
        self.rules_tree.heading("years", text="Mindest-Dienstjahre")
        self.rules_tree.heading("days", text="Urlaubstage")
        self.rules_tree.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        # Scrollbar
        scrollbar = ttk.Scrollbar(vacation_frame, orient="vertical", command=self.rules_tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.rules_tree.configure(yscrollcommand=scrollbar.set)

        # Button-Frame rechts
        btn_frame = ttk.Frame(vacation_frame)
        btn_frame.grid(row=0, column=2, sticky="ns", padx=(10, 0))

        ttk.Button(btn_frame, text="Regel Hinzufügen", command=self.add_rule).pack(fill="x", pady=2)
        ttk.Button(btn_frame, text="Regel Entfernen", command=self.remove_rule).pack(fill="x", pady=2)
        ttk.Button(btn_frame, text="Regeln Speichern", command=self.save_rules, style="Success.TButton").pack(fill="x",
                                                                                                              pady=2)

        ttk.Separator(btn_frame, orient='horizontal').pack(fill='x', pady=10)

        ttk.Button(btn_frame, text="Ansprüche JETZT\naktualisieren", command=self.run_batch_update,
                   style="Accent.TButton").pack(fill="x", pady=2)

        # (Regel 1) Daten für diesen Tab laden
        self.load_rules_data()

        # --- 3. Tab: Fenster-Konfiguration (NEU) ---
        # (Regel 4) Instanziiert den separaten Tab aus der anderen Datei
        try:
            self.window_config_tab_frame = WindowConfigTab(self.notebook)
            self.notebook.add(self.window_config_tab_frame, text="Fenster-Konfiguration")
        except Exception as e:
            print(f"[FEHLER] SettingsTab: Konnte WindowConfigTab nicht instanziieren: {e}")
            # (Regel 1) Fallback-Frame, falls die Instanziierung fehlschlägt
            error_frame = ttk.Frame(self.notebook, padding=(10, 20))
            ttk.Label(error_frame, text=f"Fehler beim Laden des Tabs:\n{e}", foreground="red").pack()
            self.notebook.add(error_frame, text="Fenster-Konfiguration")
        # --- ENDE NEU ---

    # --- ENDE KORREKTUR ---

    # --- (setup_ui() wurde durch setup_notebook_ui() ersetzt) ---

    # --- NEUE HANDLER-METHODE (GANZ OBEN) ---
    def run_role_window_type_migration(self):
        """Löst das Update für die Rollen-Fenstertyp-Spalte aus."""
        if not messagebox.askyesno("Update bestätigen",
                                   "Möchten Sie die Datenbank-Migration für die Rollen-Fensterzuweisung (window_type) jetzt ausführen?\n\n"
                                   "Dieser Vorgang ist sicher und fügt die Spalte nur hinzu, wenn sie fehlt.",
                                   parent=self):
            return

        success, message = run_db_migration_add_role_window_type()
        if success:
            messagebox.showinfo("Erfolg", message, parent=self)
        else:
            messagebox.showerror("Fehler", f"Update fehlgeschlagen:\n{message}", parent=self)

    # --- ENDE NEU ---

    # --- NEUE HANDLER-METHODE (VON VORHER) ---
    def run_role_migration(self):
        """Löst das Update für die Rollen-Berechtigungen aus."""
        if not messagebox.askyesno("Update bestätigen",
                                   "Möchten Sie die Datenbank-Migration für die Rollen-Berechtigungen (hierarchy_level, permissions) jetzt ausführen?\n\n"
                                   "Dieser Vorgang ist sicher und fügt die Spalten nur hinzu, wenn sie fehlen.",
                                   parent=self):
            return

        success, message = run_db_migration_add_role_permissions()
        if success:
            messagebox.showinfo("Erfolg", message, parent=self)
        else:
            messagebox.showerror("Fehler", f"Update fehlgeschlagen:\n{message}", parent=self)

    # --- ENDE NEU ---

    # --- INNOVATION (Regel 2 & 4): Handler für Farb-Migration ---
    def run_role_color_migration(self):
        """Löst das Update für die Rollen-Farben-Spalte aus."""
        if not messagebox.askyesno("Update bestätigen",
                                   "Möchten Sie die Datenbank-Migration für die Rollen-Farben (color_hex) jetzt ausführen?\n\n"
                                   "Dieser Vorgang ist sicher und fügt die Spalte nur hinzu, wenn sie fehlt.",
                                   parent=self):
            return

        success, message = run_db_migration_add_role_color()
        if success:
            messagebox.showinfo("Erfolg", message, parent=self)
        else:
            messagebox.showerror("Fehler", f"Update fehlgeschlagen:\n{message}", parent=self)

    # --- ENDE INNOVATION ---

    def run_update_is_approved(self):
        """Löst das Update für die is_approved Spalte aus."""
        if not messagebox.askyesno("Update bestätigen",
                                   "Sind Sie sicher, dass Sie die fehlende 'is_approved' Spalte hinzufügen möchten? Dies behebt den Registrierungsfehler.",
                                   parent=self):
            return

        success, message = run_db_update_is_approved()
        if success:
            messagebox.showinfo("Erfolg", message, parent=self)
        else:
            messagebox.showerror("Fehler", f"Update fehlgeschlagen: {message}", parent=self)

    # --- NEUE HANDLER-METHODE ---
    def run_update_activation_date(self):
        """Löst das Update für die activation_date Spalte aus."""
        if not messagebox.askyesno("Update bestätigen",
                                   "Sind Sie sicher, dass Sie die 'activation_date' Spalte hinzufügen möchten? Dies wird für zukünftig startende Mitarbeiter benötigt.",
                                   parent=self):
            return

        success, message = run_db_update_activation_date()
        if success:
            messagebox.showinfo("Erfolg", message, parent=self)
        else:
            messagebox.showerror("Fehler", f"Update fehlgeschlagen: {message}", parent=self)

    # --- ENDE NEU ---

    def run_chat_update(self):
        """Löst das Update für die Chat-Funktion aus."""
        if not messagebox.askyesno("Update bestätigen",
                                   "Sind Sie sicher, dass Sie das Update für die Chat-Funktion ausführen möchten? (last_seen Spalte und chat_messages Tabelle)",
                                   parent=self):
            return

        success, message = run_db_update_v1()
        if success:
            messagebox.showinfo("Erfolg", message, parent=self)
        else:
            messagebox.showerror("Fehler", f"Update fehlgeschlagen: {message}", parent=self)

    # --- INNOVATION: HANDLER FÜR DATENBANK-BACKUP ---
    def run_create_backup(self):
        """
        Öffnet einen Speichern-Dialog und startet den Backup-Prozess in einem Thread.
        (Regel 2: Verhindert Einfrieren der GUI)
        """
        # 1. Standard-Dateinamen vorschlagen
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        default_filename = f"dhfplaner_backup_{timestamp}.sql"

        # 2. Speichern-Dialog anzeigen
        filepath = filedialog.asksaveasfilename(
            parent=self,
            title="Datenbank-Backup speichern unter...",
            initialfile=default_filename,
            defaultextension=".sql",
            filetypes=[("SQL-Backup", "*.sql"), ("Alle Dateien", "*.*")]
        )

        if not filepath:
            # Benutzer hat Abbrechen gedrückt
            return

        # 3. Zeige "In Bearbeitung"-Nachricht (nicht-blockierend)
        #    Wir können das Hauptfenster (self) als Parent verwenden.
        messagebox.showinfo(
            "Backup gestartet",
            f"Das Datenbank-Backup wird jetzt erstellt und als '{os.path.basename(filepath)}' gespeichert.\n\n"
            "Dieser Vorgang kann einen Moment dauern. Die GUI bleibt bedienbar. "
            "Sie erhalten eine Nachricht, wenn der Vorgang abgeschlossen ist.",
            parent=self
        )

        # 4. Backup-Logik in einem separaten Thread ausführen
        backup_thread = threading.Thread(
            target=self._execute_backup_thread,
            args=(filepath,)
        )
        backup_thread.start()

    def _execute_backup_thread(self, filepath):
        """
        Diese Methode läuft im Thread und führt das eigentliche Backup aus.
        """
        try:
            success, message = create_database_backup(filepath)

            if success:
                # Erfolg im Main-Thread anzeigen (wichtig für Tkinter!)
                self.after(0, lambda: messagebox.showinfo(
                    "Erfolg",
                    "Das Datenbank-Backup wurde erfolgreich erstellt.",
                    parent=self
                ))
            else:
                # Fehler im Main-Thread anzeigen
                self.after(0, lambda: messagebox.showerror(
                    "Backup fehlgeschlagen",
                    f"Das Backup konnte nicht erstellt werden:\n\n{message}",
                    parent=self
                ))
        except Exception as e:
            # Fallback für unerwartete Fehler im Thread
            self.after(0, lambda: messagebox.showerror(
                "Kritischer Fehler",
                f"Ein unerwarteter Fehler im Backup-Thread ist aufgetreten:\n{e}",
                parent=self
            ))

    # --- ENDE INNOVATION ---


    # --- NEUE METHODEN FÜR URLAUBSREGELN ---

    def load_rules_data(self):
        """Lädt die Regeln aus der DB und füllt den Treeview."""
        self.rules_tree.delete(*self.rules_tree.get_children())

        config_data = load_config_json(VACATION_RULES_CONFIG_KEY)

        if not config_data or not isinstance(config_data, list):
            # Standard-Regel (Basisanspruch)
            self.vacation_rules = [{"years": 0, "days": 30}]
        else:
            # Sortieren für die Anzeige (nach Jahren aufsteigend)
            self.vacation_rules = sorted(config_data, key=lambda r: r.get('years', 0))

        for rule in self.vacation_rules:
            self.rules_tree.insert("", "end", values=(rule["years"], rule["days"]))

    def add_rule(self):
        """Fügt eine neue Regel hinzu (via Dialog)."""
        try:
            years = simpledialog.askinteger("Dienstjahre", "Nach wie vielen vollen Dienstjahren gilt die Regel?",
                                            parent=self, minvalue=0)
            if years is None:
                return

            days = simpledialog.askinteger("Urlaubstage", f"Wie viele Urlaubstage gibt es ab {years} Jahren?",
                                           parent=self, minvalue=0)
            if days is None:
                return

            # Prüfen, ob die Regel (Jahre) schon existiert
            for item_id in self.rules_tree.get_children():
                existing_years = self.rules_tree.item(item_id, "values")[0]
                if int(existing_years) == years:
                    messagebox.showwarning("Doppelt",
                                           f"Eine Regel für {years} Jahre existiert bereits. Bitte entfernen Sie die alte Regel zuerst.",
                                           parent=self)
                    return

            # Zur GUI hinzufügen
            item_id = self.rules_tree.insert("", "end", values=(years, days))
            # Sortieren
            self.sort_treeview()
            self.rules_tree.selection_set(item_id)

        except ValueError:
            messagebox.showerror("Ungültig", "Bitte geben Sie gültige Zahlen ein.", parent=self)
        except Exception as e:
            messagebox.showerror("Fehler", f"Ein Fehler ist aufgetreten: {e}", parent=self)

    def remove_rule(self):
        """Entfernt die ausgewählte Regel."""
        selected_item = self.rules_tree.selection()
        if not selected_item:
            messagebox.showwarning("Auswahl fehlt",
                                   "Bitte wählen Sie zuerst eine Regel aus, die Sie entfernen möchten.", parent=self)
            return

        if not messagebox.askyesno("Löschen", "Möchten Sie die ausgewählte Regel wirklich entfernen?", parent=self):
            return

        self.rules_tree.delete(selected_item)

    def sort_treeview(self):
        """Sortiert den Treeview nach Jahren (aufsteigend)."""
        items = [(int(self.rules_tree.item(i, "values")[0]), i) for i in self.rules_tree.get_children()]
        items.sort()
        for index, (years, item_id) in enumerate(items):
            self.rules_tree.move(item_id, "", index)

    def save_rules(self):
        """Speichert die Regeln aus dem Treeview in der Datenbank."""
        new_rules = []
        try:
            for item_id in self.rules_tree.get_children():
                values = self.rules_tree.item(item_id, "values")
                rule = {"years": int(values[0]), "days": int(values[1])}
                new_rules.append(rule)
        except (ValueError, TypeError):
            messagebox.showerror("Fehler", "Ungültige Daten im Treeview.", parent=self)
            return

        if not new_rules:
            if not messagebox.askyesno("Warnung",
                                       "Sie sind im Begriff, alle Regeln zu löschen. Der Standard-Urlaubsanspruch (30 Tage) wird dann verwendet. Fortfahren?",
                                       parent=self):
                return

        if save_config_json(VACATION_RULES_CONFIG_KEY, new_rules):
            self.vacation_rules = new_rules  # Cache aktualisieren
            messagebox.showinfo("Gespeichert", "Die Urlaubsregeln wurden erfolgreich gespeichert.", parent=self)
        else:
            messagebox.showerror("Fehler", "Die Regeln konnten nicht in der Datenbank gespeichert werden.", parent=self)

    def run_batch_update(self):
        """Startet das Batch-Update für alle Benutzer."""
        if not self.session_user:
            messagebox.showerror("Fehler", "Sitzungsbenutzer nicht gefunden.", parent=self)
            return

        if not messagebox.askyesno("Update Bestätigen",
                                   "Möchten Sie jetzt die Urlaubsansprüche (Gesamt UND Rest) aller aktiven Mitarbeiter basierend auf den gespeicherten Regeln neu berechnen?\n\n"
                                   "Dies sollte typischerweise nur einmal pro Jahr oder nach einer Regeländerung geschehen.",
                                   parent=self):
            return

        try:
            current_user_id = self.session_user['id']
            success, message = admin_batch_update_vacation_entitlements(current_user_id)

            if success:
                messagebox.showinfo("Erfolg", f"Update abgeschlossen.\n{message}", parent=self)
            else:
                messagebox.showerror("Fehler", f"Update fehlgeschlagen:\n{message}", parent=self)
        except Exception as e:
            messagebox.showerror("Kritischer Fehler", f"Ein unerwarteter Fehler ist aufgetreten: {e}", parent=self)

    # --- ENDE NEU ---