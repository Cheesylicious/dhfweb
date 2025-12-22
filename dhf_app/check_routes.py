from dhf_app import create_app

app = create_app()

print("\n" + "="*50)
print("AKTIV REGISTRIERTE ROUTEN:")
print("="*50)

# Suche spezifisch nach unserer Problem-Route
found = False
for rule in app.url_map.iter_rules():
    if "shift" in str(rule) or "request" in str(rule):
        print(f"URL: {rule}  --> Endpunkt: {rule.endpoint}")
        found = True

if not found:
    print("ACHTUNG: Keine Route mit 'shift' oder 'request' gefunden!")
else:
    print("-" * 50)
    print("Prüfen Sie, ob die URL exakt '/api/shift-change/request' lautet.")

print("="*50 + "\n")