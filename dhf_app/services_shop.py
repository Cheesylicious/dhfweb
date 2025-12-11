import random  # WICHTIG: Import für Zufallsauswahl
from datetime import datetime, timedelta
from sqlalchemy import func
from dhf_app.extensions import db
from dhf_app.models import User
from dhf_app.models_gamification import UserGamificationStats
from dhf_app.models_shop import ShopItem, UserActiveEffect


class ShopService:
    """
    Zentraler Service für Shop-Logik und Transaktionen.
    """

    @staticmethod
    def get_all_items(include_inactive=False):
        """ Gibt alle Shop-Items zurück (für die Anzeige im Shop). """
        try:
            query = ShopItem.query
            # FIX: Diese Logik wird nun fast immer ignoriert (include_inactive=True wird in der Route gesetzt)
            if not include_inactive:
                query = query.filter_by(is_active=True)
            return [item.to_dict() for item in query.all()]
        except Exception as e:
            print(f"ShopService ERROR in get_all_items: {e}")
            return []

    @staticmethod
    def update_item_price(item_id, new_price, admin_user):
        item = ShopItem.query.get(item_id)
        if not item:
            return {"success": False, "message": "Item nicht gefunden."}

        try:
            item.cost_xp = int(new_price)
            db.session.commit()
            return {"success": True, "message": "Preis aktualisiert."}
        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Datenbankfehler beim Preis-Update: {str(e)}"}

    @staticmethod
    def toggle_item_active_status(item_id, is_active, message=""):
        item = ShopItem.query.get(item_id)
        if not item:
            return {"success": False, "message": "Item nicht gefunden."}

        try:
            item.is_active = is_active
            if not is_active:
                item.deactivation_message = message if message else "Aktuell nicht verfügbar."
            else:
                item.deactivation_message = None

            db.session.commit()
            action = "aktiviert" if is_active else "deaktiviert"
            return {"success": True, "message": f"Item '{item.name}' erfolgreich {action}."}
        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Datenbankfehler beim De-/Aktivieren: {str(e)}"}

    @staticmethod
    def buy_item(user_id, item_id):
        # 1. Daten abrufen
        user = User.query.get(user_id)
        item = ShopItem.query.get(item_id)
        stats = UserGamificationStats.query.filter_by(user_id=user_id).first()

        if not user or not item:
            return {"success": False, "message": "Benutzerprofil oder Item nicht gefunden."}

        if not item.is_active:
            return {"success": False,
                    "message": f"Dieses Item ist aktuell nicht verfügbar: {item.deactivation_message}"}

        if not stats or stats.points_total is None:
            return {"success": False, "message": "XP-Guthaben konnte nicht abgerufen werden."}

        # 2. XP-Prüfung
        current_xp = stats.points_total
        if current_xp < item.cost_xp:
            return {"success": False, "message": "Nicht genügend Erfahrungspunkte. Kaufe mehr XP!"}

        try:
            # 3. XP Abziehen
            stats.points_total -= item.cost_xp

            # --- EFFEKT-LOGIK NACH ITEM-TYP ---

            if item.item_type == 'xp_multiplier':
                # Logik für Booster (Stapeln der Dauer)
                existing_effect = UserActiveEffect.query.filter(
                    UserActiveEffect.user_id == user.id,
                    UserActiveEffect.multiplier_value == item.multiplier_value,
                    UserActiveEffect.end_date > datetime.utcnow()
                ).first()

                if existing_effect:
                    existing_effect.end_date += timedelta(days=item.duration_days)
                    msg = f"{item.name} verlängert! Neue Laufzeit bis: {existing_effect.end_date.strftime('%d.%m.%Y')}"
                else:
                    new_end = datetime.utcnow() + timedelta(days=item.duration_days)
                    new_effect = UserActiveEffect(
                        user_id=user.id,
                        item_id=item.id,
                        multiplier_value=item.multiplier_value,
                        end_date=new_end
                    )
                    db.session.add(new_effect)
                    msg = f"{item.name} gekauft! Aktiv bis: {new_end.strftime('%d.%m.%Y')}"

            elif item.item_type == 'cosmetic_pet':
                # Logik für Animierte Figur
                asset_key = item.asset_key

                if not asset_key:
                    msg = f"Fehler: Das Item '{item.name}' ist fehlerhaft konfiguriert (Asset-Key fehlt)."
                    return {"success": False, "message": msg}

                user.active_pet_asset = asset_key
                msg = f"'{item.name}' wurde erfolgreich gekauft und als aktiver Begleiter gesetzt!"

            elif item.item_type == 'theme':
                # NEU: Logik für Design-Themes
                asset_key = item.asset_key

                if not asset_key:
                    msg = f"Fehler: Theme '{item.name}' hat keinen CSS-Key."
                    return {"success": False, "message": msg}

                # Theme speichern
                user.active_theme = asset_key
                msg = f"Design '{item.name}' wurde erfolgreich aktiviert!"

            elif item.item_type == 'oracle':
                # --- DAS GROSSE DIENST-ORAKEL (100 Sprüche) ---
                options = [
                    # --- KATEGORIE: DER HUND ---
                    "Dein Diensthund plant heimlich die Weltherrschaft. Heute beginnt Phase 1.",
                    "Hüte dich vor nassen Hundezungen im Gesicht.",
                    "Dein Hund wird heute pupsen. Genau dann, wenn der Chef reinkommt.",
                    "Der Hund hat heute mehr Ahnung vom Dienst als du. Hör auf ihn.",
                    "Ein 'Sitz' funktioniert heute nur mit Bestechungsgeld.",
                    "Dein Hund hält dich für das schwächste Glied im Rudel.",
                    "Heute findet dein Hund etwas Ekliges. Und er wird es fressen.",
                    "Das Fell auf deiner Uniform wird heute ein neues Muster bilden.",
                    "Dein Hund träumt von Katzen. Verrate es ihm nicht.",
                    "Vorsicht beim Spielen: Die Zähne sind heute besonders spitz.",
                    "Der Hund hat heute gute Laune. Das ist verdächtig.",
                    "Dein Hund riecht Angst. Und Wurstbrot. Vor allem Wurstbrot.",
                    "Heute ist ein guter Tag für Unterordnung. Sagt der Hund.",
                    "Ein nasser Hund riecht nach Arbeit. Du wirst heute viel arbeiten.",
                    "Dein Hund wird heute einen Zivilisten anbellen. Grundlos.",
                    "Der Zwinger ist heute sauberer als dein Auto.",
                    "Dein Hund liebt dich. Aber er liebt den Ball mehr.",
                    "Achte auf die Rute. Sie wedelt heute in Richtung Chaos.",
                    "Dein Hund wird heute einen Befehl ignorieren. Einfach so. Weil er es kann.",
                    "Heute ist Tag des Sabberfadens auf der Hose.",

                    # --- KATEGORIE: SCHICHTDIENST & KOLLEGEN ---
                    "Der nächste Nachtdienst wird ruhig... verdächtig ruhig.",
                    "Sag niemals das Wort mit 'R' (Ruhig). Niemals.",
                    "Jemand wird versuchen, eine Schicht zu tauschen. Bleib stark.",
                    "Der Kaffeeautomat ist heute dein einziger wahrer Freund.",
                    "Dein Funkgerät wird genau dann rauschen, wenn du es nicht brauchst.",
                    "Ein Kollege wird heute eine sehr dumme Frage stellen.",
                    "Der Schichtplan lügt. Bereite dich auf Änderungen vor.",
                    "Heute hast du Recht. Aber keiner wird dir zuhören.",
                    "Vermeide Augenkontakt mit dem Vorgesetzten.",
                    "Jemand hat deinen Lieblings-Kugelschreiber geklaut.",
                    "Die Ablöse wird heute 5 Minuten zu spät kommen.",
                    "Du wirst heute Dinge sehen, die du nicht sehen wolltest.",
                    "Ein Bericht schreiben dauert heute dreimal so lange wie gedacht.",
                    "Der Drucker riecht deine Angst. Er wird Papierstau haben.",
                    "Heute ist ein guter Tag, um unsichtbar zu sein.",
                    "Deine Pause wird heute unterbrochen. Garantiert.",
                    "Ein Kollege bringt heute Kuchen mit. (Hoffentlich).",
                    "Achtung: Der Mond ist fast voll. Die Verrückten erwachen.",
                    "Heute Nacht passieren seltsame Dinge auf dem Monitor.",
                    "Deine Motivation hat sich krankgemeldet.",

                    # --- KATEGORIE: MURPHY'S LAW & CHAOS ---
                    "Hüte dich vor Pfützen, sie sind tiefer als du denkst.",
                    "Das Wetter wird umschlagen, sobald du aus dem Auto steigst.",
                    "Du hast etwas zu Hause vergessen. Etwas Wichtiges.",
                    "Deine Stiefel sind heute nicht wasserdicht.",
                    "Die Taschenlampe wird leer sein, wenn es dunkel wird.",
                    "Der Schlüsselbund wird heute besonders schwer sein.",
                    "Ein Schnürsenkel wird aufgehen. Im unpassendsten Moment.",
                    "Das Einsatzfahrzeug wird heute komische Geräusche machen.",
                    "Dein Handy-Akku wird heute nicht bis Schichtende halten.",
                    "Heute ist der Tag, an dem du Kaffee verschüttest.",
                    "Das Chaos wartet nur darauf, dass du deine Stiefel ausziehst.",
                    "Wenn alles gut läuft, hast du etwas übersehen.",
                    "Die Technik wird dich heute im Stich lassen.",
                    "Du wirst heute frieren. Oder schwitzen. Aber nicht wohlfühlen.",
                    "Der Weg zum Klo wird heute der längste deines Lebens.",
                    "Eine Spinne hat sich in deinem Spind versteckt.",
                    "Dein Mittagessen wird heute nicht schmecken.",
                    "Heute ist ein guter Tag für Überstunden (sagt niemand).",
                    "Das Universum hat heute einen seltsamen Humor.",
                    "Sei bereit für das Unerwartete. Und bring Wechselkleidung mit.",

                    # --- KATEGORIE: MOTIVATION & SARKASMUS ---
                    "Du bist der Wächter der Nacht. Und du brauchst Schlaf.",
                    "Helden tragen keine Umhänge, sie tragen Hundehaare.",
                    "Lächle einfach und winke. Es verwirrt die Leute.",
                    "Deine Geduld wird heute getestet. Ergebnis: Negativ.",
                    "Denk dran: Nur noch X Stunden bis Feierabend.",
                    "Du machst das großartig. Glaube ich zumindest.",
                    "Heute ist der erste Tag vom Rest deiner Schicht.",
                    "Sei der Mensch, für den dein Hund dich hält.",
                    "Atmen nicht vergessen. Ist wichtig.",
                    "Kopf hoch, sonst fällt die Krone runter.",
                    "Karma hat heute Schichtfrei. Du musst selbst ran.",
                    "Sarkasmus ist heute deine beste Verteidigung.",
                    "Tu so, als hättest du einen Plan.",
                    "Kaffee: Die wichtigste Mahlzeit des Tages.",
                    "Du bist nicht müde, du bist im Energiesparmodus.",
                    "Die Stimmen im Funkgerät lügen nicht.",
                    "Heute bist du der Hammer. Alle anderen sind Nägel.",
                    "Halt durch. Bald ist Wochenende (oder Montag).",
                    "Du hast schon Schlimmeres überlebt.",
                    "Sei wachsam. Das Wochenende naht.",

                    # --- KATEGORIE: ABSURDES & MYSTISCHES ---
                    "Ein Eichhörnchen plant eine Verschwörung gegen dich.",
                    "Die Zahl 42 wird heute eine Rolle spielen.",
                    "Meide heute Menschen, die Socken in Sandalen tragen.",
                    "Ein alter Bekannter wird heute auftauchen.",
                    "Das Orakel sieht... Nebel. Viel Nebel.",
                    "Du wirst heute etwas finden, das du vor Jahren verloren hast.",
                    "Die Farbe Blau bringt dir heute Glück.",
                    "Iss heute keinen gelben Schnee. (Gilt immer).",
                    "Ein Vogel wird heute auf dein Auto zielen.",
                    "Die Antwort auf deine Frage ist: Vielleicht.",
                    "Frag später nochmal. Das Orakel macht Mittagspause.",
                    "Die Geister der vergangenen Schichten beobachten dich.",
                    "Hüte dich vor dem Mann mit dem Klemmbrett.",
                    "Heute ist ein guter Tag, um Lotto zu spielen. (Ohne Gewähr).",
                    "Dein Schatten führt heute ein Eigenleben.",
                    "Die Macht ist stark in dir. Aber der Kaffee ist stärker.",
                    "Ein Keks wird heute dein Schicksal besiegeln.",
                    "Du wirst heute eine heldenhafte Tat vollbringen: Aufstehen.",
                    "Das Orakel sieht eine Gehaltserhöhung... in ferner Zukunft.",
                    "Alles wird gut. Irgendwann."
                ]

                oracle_spruch = random.choice(options)
                msg = f"🔮 Das Orakel spricht:\n\n\"{oracle_spruch}\""

            else:
                # Fallback für unbekannte Items
                msg = f"{item.name} erfolgreich gekauft!"

            # 4. Transaktion abschließen
            db.session.commit()
            return {"success": True, "message": msg, "new_xp": stats.points_total}

        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Datenbankfehler bei Kaufabwicklung: {str(e)}"}

    @staticmethod
    def get_user_active_effects(user_id):
        """
        Gibt aktive, nicht abgelaufene Effekte des Users zurück.
        """
        now = datetime.utcnow()
        result = []

        try:
            effects = UserActiveEffect.query.filter(
                UserActiveEffect.user_id == user_id,
                UserActiveEffect.end_date > now
            ).all()
        except Exception as e:
            print(f"ShopService KRITISCHER DB-FEHLER in get_user_active_effects: {e}")
            return []

        for eff in effects:
            item = ShopItem.query.get(eff.item_id)
            if not item:
                continue

            result.append({
                'name': item.name,
                'multiplier': eff.multiplier_value,
                'end_date': eff.end_date.strftime('%d.%m.%Y %H:%M'),
                'days_left': (eff.end_date - now).days
            })
        return result

    @staticmethod
    def init_default_items():
        pass