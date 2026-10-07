#!/usr/bin/env python3
import pathlib
import sys

IMPORT_OLD = 'import * as WebUtil from "./webutil.js";\n'
IMPORT_NEW = (
    IMPORT_OLD
    + 'import { androidActions, ignoreAndroidUnderscore, isAndroid, PAD_CODE, padding } from "./android-keys.js";\n'
)

RESET_OLD = 'kbi.value = new Array(UI.defaultKeyboardinputLen).join("_");'
RESET_NEW = "kbi.value = padding(UI.defaultKeyboardinputLen);"

KEY_EVENT_OLD = """    keyEvent(keysym, code, down) {
        if (!UI.rfb) return;

        UI.rfb.sendKey(keysym, code, down);
    },"""

KEY_EVENT_NEW = """    keyEvent(keysym, code, down) {
        if (!UI.rfb) return;
        if (ignoreAndroidUnderscore(keysym, navigator.userAgent)) return;

        UI.rfb.sendKey(keysym, code, down);
    },"""

KEY_INPUT_OLD = """    keyInput(event) {

        if (!UI.rfb) return;

        const newValue = event.target.value;
"""

KEY_INPUT_NEW = """    keyInput(event) {

        if (!UI.rfb) return;

        if (isAndroid(navigator.userAgent)) {
            if (UI._androidSuppress) return;
            const actions = androidActions(UI._androidTyped || "", event.target.value);
            UI._androidSuppress = true;
            try {
                for (let n = 0; n < actions.backspaces; n++) {
                    UI.rfb.sendKey(KeyTable.XK_BackSpace, "Backspace");
                }
                for (const ch of actions.insert) {
                    UI.rfb.sendKey(keysyms.lookup(ch.codePointAt(0)));
                }
                const next = padding(UI.defaultKeyboardinputLen) + actions.typed;
                UI._androidTyped = actions.typed;
                UI.lastKeyboardinput = next;
                if (event.target.value !== next) {
                    event.target.value = next;
                    try {
                        event.target.setSelectionRange(next.length, next.length);
                    } catch (err) {
                    }
                }
            } finally {
                UI._androidSuppress = false;
            }
            return;
        }

        const newValue = event.target.value;
"""

SEND_OLD = """        for (let i = newLen - inputs; i < newLen; i++) {
            UI.rfb.sendKey(keysyms.lookup(newValue.charCodeAt(i)));
        }
"""

SEND_NEW = """        for (let i = newLen - inputs; i < newLen; i++) {
            const codePoint = newValue.charCodeAt(i);
            if (codePoint === PAD_CODE) continue;
            UI.rfb.sendKey(keysyms.lookup(codePoint));
        }
"""

HTML_OLD = '<script type="module" crossorigin="anonymous" src="app/ui.js"></script>'
HTML_NEW = '<script type="module" crossorigin="anonymous" src="app/ui.js?v=android-keys"></script>'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def patch_ui(text):
    text = replace_once(text, IMPORT_OLD, IMPORT_NEW, "import")
    text = replace_once(text, RESET_OLD, RESET_NEW, "keyboardinputReset")
    text = replace_once(text, KEY_EVENT_OLD, KEY_EVENT_NEW, "keyEvent")
    text = replace_once(text, KEY_INPUT_OLD, KEY_INPUT_NEW, "keyInput")
    text = replace_once(text, SEND_OLD, SEND_NEW, "send loop")
    return text


def patch_html(text):
    return replace_once(text, HTML_OLD, HTML_NEW, "vnc.html")


def main(argv):
    if len(argv) != 2:
        raise SystemExit("usage: patch-novnc.py /usr/share/novnc")
    root = pathlib.Path(argv[1])
    ui = root / "app" / "ui.js"
    html = root / "vnc.html"
    ui.write_text(patch_ui(ui.read_text()))
    html.write_text(patch_html(html.read_text()))


if __name__ == "__main__":
    main(sys.argv)
