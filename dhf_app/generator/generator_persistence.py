# dhf_app/generator/generator_persistence.py

from datetime import datetime, date
import calendar
from ..extensions import db
from ..models import Shift, ShiftType


def save_generation_batch_to_db(live_shifts_data, year, month, variant_id=None):
    """
    Speichert den generierten Plan in die Datenbank.
    Nutzt SQLAlchemy für Transaktionssicherheit und Konsistenz.
    Unterstützt Plan-Varianten.

    Strategie:
    1. Alle Schichtarten laden (Mapping Abkürzung -> ID).
    2. Alle existierenden Schichten des Monats (für die Variante) laden.
    3. Abgleich:
       - Neue Einträge -> INSERT
       - Geänderte Einträge -> UPDATE
       - Leere Einträge (jetzt FREI) -> DELETE
    """
    try:
        # 1. Mappings laden
        shift_types = ShiftType.query.all()
        abbr_to_id = {st.abbreviation: st.id for st in shift_types}

        # 2. Bestehende Schichten für den Monat laden (Batch)
        # Filtert nach der spezifischen Variante (oder Hauptplan, wenn None)
        _, last_day = calendar.monthrange(year, month)
        start_date = date(year, month, 1)
        end_date = date(year, month, last_day)

        existing_shifts = Shift.query.filter(
            Shift.date >= start_date,
            Shift.date <= end_date,
            Shift.variant_id == variant_id  # <<< NEU: Filterung nach Variante
        ).all()

        # Map für schnellen Zugriff: (user_id, "YYYY-MM-DD") -> Shift-Objekt
        existing_map = {
            (s.user_id, s.date.strftime('%Y-%m-%d')): s
            for s in existing_shifts
        }

        count_updates = 0
        count_inserts = 0
        count_deletes = 0

        # 3. Abgleich durchführen
        for user_id_str, day_map in live_shifts_data.items():
            try:
                user_id = int(user_id_str)
            except ValueError:
                continue

            for date_str, shift_abbr in day_map.items():
                # Sicherheitscheck: Nur Daten des angeforderten Monats speichern
                if not date_str.startswith(f"{year}-{month:02d}"):
                    continue

                current_db_shift = existing_map.get((user_id, date_str))

                # Fall A: Es soll eine Schicht gesetzt werden (kein "Frei")
                if shift_abbr and shift_abbr in abbr_to_id:
                    target_type_id = abbr_to_id[shift_abbr]

                    if current_db_shift:
                        # Update nur, wenn sich der Typ geändert hat
                        if current_db_shift.shifttype_id != target_type_id:
                            current_db_shift.shifttype_id = target_type_id
                            count_updates += 1
                    else:
                        # Insert (Neu)
                        new_shift = Shift(
                            user_id=user_id,
                            date=datetime.strptime(date_str, '%Y-%m-%d').date(),
                            shifttype_id=target_type_id,
                            variant_id=variant_id  # <<< NEU: Variante setzen
                        )
                        db.session.add(new_shift)
                        count_inserts += 1

                # Fall B: Der Generator hat "Frei" geplant (leerer String oder spezielle Marker)
                # -> Eintrag muss aus der DB entfernt werden, falls vorhanden
                else:
                    if current_db_shift:
                        db.session.delete(current_db_shift)
                        count_deletes += 1

        # 4. Transaktion abschließen
        db.session.commit()

        total_ops = count_inserts + count_updates + count_deletes
        # Debug-Ausgabe im Server-Log
        variant_label = f"Variante {variant_id}" if variant_id else "Hauptplan"
        print(f"[Persistence] Batch OK ({variant_label}): +{count_inserts} / ~{count_updates} / -{count_deletes}")

        return True, total_ops, None

    except Exception as e:
        db.session.rollback()
        return False, 0, str(e)