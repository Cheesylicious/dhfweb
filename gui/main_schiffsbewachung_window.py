# gui/main_schiffsbewachung_window.py
# (NEUE DATEI - Regel 4)

import tkinter as tk
from tkinter import ttk


class MainSchiffsbewachungWindow(tk.Toplevel):
    """
    Ein neues, modernes Hauptfenster speziell für die Schiffsbewachung.
    Es hält sich an die vom boot_loader.py erwartete Signatur.
    """

    def __init__(self, master, user_data, app):
        """
        Initialisiert das Hauptfenster für die Schiffsbewachung.

        :param master: Das übergeordnete Fenster (die Application-Instanz).
        :param user_data: Das Dictionary mit den Daten des angemeldeten Benutzers.
        :param app: Die Hauptanwendungsinstanz (identisch mit master).
        """
        super().__init__(master)
        self.user_data = user_data
        self.app = app  # Die Boot-Loader-Instanz

        print(f"[SchiffsbewachungWindow] Initialisiere Fenster für: {user_data.get('username')}")

        # --- Modernes Design-Setup ---
        self.configure(bg="#2c3e50")
        self.title("DHF-Planer: Schiffsbewachung")

        # Fenstereinstellungen (Vollbild)
        self.attributes('-fullscreen', True)
        self.bind("<Escape>", self.app.on_app_close)  # Notausgang mit ESC

        # --- Styling (Futuristischer Look) ---
        self.style = ttk.Style(self)
        self.style.theme_use('clam')

        # Hintergrund- und Vordergrundfarben
        bg_color = "#2c3e50"
        fg_color = "#ecf0f1"
        accent_color = "#3498db"
        light_bg = "#34495e"

        self.style.configure('.', background=bg_color, foreground=fg_color, font=('Segoe UI', 10))
        self.style.configure('TFrame', background=bg_color)
        self.style.configure('TLabel', background=bg_color, foreground=fg_color)

        # Header-Label
        self.style.configure('Header.TLabel', font=('Segoe UI', 24, 'bold'), foreground=accent_color)

        # Info-Label
        self.style.configure('Info.TLabel', font=('Segoe UI', 12, 'italic'), foreground="#95a5a6")

        # Buttons
        self.style.configure('TButton', background=accent_color, foreground=bg_color, font=('Segoe UI', 12, 'bold'),
                             borderwidth=0)
        self.style.map('TButton', background=[('active', '#2980b9')])

        # Logout-Button (spezieller Stil)
        self.style.configure('Logout.TButton', background="#e74c3c", foreground="#ecf0f1")
        self.style.map('Logout.TButton', background=[('active', '#c0392b')])

        # --- Haupt-Layout ---
        self.main_frame = ttk.Frame(self, style='TFrame')
        self.main_frame.pack(fill="both", expand=True, padx=50, pady=50)

        # 1. Header-Bereich
        header_frame = ttk.Frame(self.main_frame)
        header_frame.pack(fill="x", pady=(0, 20))

        ttk.Label(header_frame, text="MODUL SCHIFFSBEWACHUNG", style='Header.TLabel').pack(side="left")

        # Benutzer-Info und Logout
        user_info_frame = ttk.Frame(header_frame)
        user_info_frame.pack(side="right")

        user_display_name = f"{user_data.get('vorname', '')} {user_data.get('name', '')}"
        ttk.Label(user_info_frame, text=f"Angemeldet als: {user_display_name}", anchor="e").pack(fill="x")

        ttk.Button(user_info_frame, text="Abmelden", command=self.app.on_logout, style='Logout.TButton').pack(pady=5)

        # 2. Content-Bereich (Platzhalter)
        content_frame = ttk.Frame(self.main_frame, style='TFrame', relief="solid", borderwidth=1)
        content_frame.pack(fill="both", expand=True, pady=20)

        # Styling für den inneren Rahmen (optional)
        content_frame.configure(style='Card.TFrame')
        self.style.configure('Card.TFrame', background=light_bg)

        ttk.Label(
            content_frame,
            text="Willkommen im Modul Schiffsbewachung.",
            style='Header.TLabel',
            font=('Segoe UI', 18, 'bold')
        ).pack(pady=50)

        ttk.Label(
            content_frame,
            text="Dieser Bereich ist noch in Entwicklung.\n"
                 "Hier werden zukünftig die spezifischen Funktionen\n"
                 "für die Planung der Schiffsbewachung implementiert.",
            style='Info.TLabel',
            justify="center"
        ).pack(pady=20, padx=50)

    def on_close(self):
        """
        Wird aufgerufen, wenn das Fenster geschlossen wird (z.B. über das "X").
        Leitet zur Haupt-App-Schließfunktion weiter.
        """
        self.app.on_app_close()

    def deiconify(self):
        """
        Überschreibt die Standardmethode, um das Fenster korrekt anzuzeigen.
        """
        super().deiconify()
        self.lift()
        self.focus_force()
        self.attributes('-fullscreen', True)  # Stellt sicher, dass es Vollbild bleibt

    def wait_visibility(self):
        """Wird vom boot_loader aufgerufen."""
        super().wait_visibility()

    def update_idletasks(self):
        """Wird vom boot_loader aufgerufen."""
        super().update_idletasks()