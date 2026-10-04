# Writes a Stream Deck profile with the Display Pixel action on every XL key.
# Run only while the Elgato app is quit; it reads profiles at startup.
# The XL is found from an existing profile; pass its device UUID to override.
import glob, json, os, sys, uuid
root = os.path.expanduser('~/Library/Application Support/com.elgato.StreamDeck/ProfilesV3')
XL_MODELS = ("20GAT9901", "20GAT9902")
known = [json.load(open(f)).get("Device") or {} for f in glob.glob(f"{root}/*.sdProfile/manifest.json")]
xls = {d["UUID"]: d for d in known if d.get("Model") in XL_MODELS}
if len(sys.argv) > 1:
    device = xls.get(sys.argv[1]) or sys.exit(f"no XL with UUID {sys.argv[1]}; known: {list(xls)}")
elif len(xls) == 1:
    device = next(iter(xls.values()))
else:
    sys.exit(f"found {len(xls)} XLs; pass one UUID as an argument: {list(xls)}" if xls else
             "no Stream Deck XL found; open the Elgato app with the XL plugged in once, then quit it")
pid, page, empty = (str(uuid.uuid4()).upper() for _ in range(3))
actions = {
    f"{c},{r}": {
        "ActionID": str(uuid.uuid4()), "LinkedTitle": True, "Name": "Display Pixel",
        "Plugin": {"Name": "Audio Display", "UUID": "com.wrtsprt.audio-display", "Version": "0.1.0.0"},
        "Resources": None, "Settings": {}, "State": 0, "States": [{}],
        "UUID": "com.wrtsprt.audio-display.pixel",
    }
    for c in range(8) for r in range(4)
}
base = f"{root}/{pid}.sdProfile"
for p, body in {
    page: {"Controllers": [{"Actions": actions, "Type": "Keypad"}], "Icon": "", "Name": ""},
    empty: {"Controllers": [{"Actions": None, "Type": "Keypad"}], "Icon": "", "Name": ""},
}.items():
    os.makedirs(f"{base}/Profiles/{p}")
    json.dump(body, open(f"{base}/Profiles/{p}/manifest.json", "w"))
json.dump({"Device": device, "Name": "Audio Display", "Pages": {"Current": page.lower(), "Default": empty.lower(), "Pages": [page.lower()]}, "Version": "3.0"}, open(f"{base}/manifest.json", "w"))
print(base)
