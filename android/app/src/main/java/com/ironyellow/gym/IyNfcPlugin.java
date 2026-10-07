package com.ironyellow.gym;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;

/**
 * Lector NFC del kiosco (control de acceso). Usa "foreground dispatch": mientras la app está
 * abierta y el lector encendido, ESTA app recibe el tag y el sistema NO abre la app de NFC del
 * teléfono. Devuelve el UID (04:fd:1d:...) y los registros de texto NDEF del tag.
 */
@CapacitorPlugin(name = "IyNfc")
public class IyNfcPlugin extends Plugin {
    private boolean active = false;

    private NfcAdapter adapter() {
        Activity a = getActivity();
        return a == null ? null : NfcAdapter.getDefaultAdapter(a);
    }

    @PluginMethod
    public void status(PluginCall call) {
        NfcAdapter ad = adapter();
        JSObject r = new JSObject();
        r.put("supported", ad != null);
        r.put("enabled", ad != null && ad.isEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        NfcAdapter ad = adapter();
        if (ad == null) { call.reject("Este teléfono no tiene NFC"); return; }
        if (!ad.isEnabled()) { call.reject("El NFC está apagado. Actívalo en los ajustes del teléfono."); return; }
        active = true;
        enable();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        disable();
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Activity a = getActivity();
        if (a == null) { call.reject("Sin pantalla activa"); return; }
        a.startActivity(new Intent(Settings.ACTION_NFC_SETTINGS));
        call.resolve();
    }

    private void enable() {
        final Activity a = getActivity();
        final NfcAdapter ad = adapter();
        if (a == null || ad == null) return;
        a.runOnUiThread(() -> {
            try {
                Intent i = new Intent(a, a.getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pi = PendingIntent.getActivity(a, 0, i, flags);
                ad.enableForegroundDispatch(a, pi, null, null); // null = cualquier tag
            } catch (Exception ignored) {
            }
        });
    }

    private void disable() {
        final Activity a = getActivity();
        final NfcAdapter ad = adapter();
        if (a == null || ad == null) return;
        a.runOnUiThread(() -> {
            try { ad.disableForegroundDispatch(a); } catch (Exception ignored) { }
        });
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (active) enable();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        disable();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!active || intent == null) return;
        String action = intent.getAction();
        if (!NfcAdapter.ACTION_TAG_DISCOVERED.equals(action) && !NfcAdapter.ACTION_TECH_DISCOVERED.equals(action) && !NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)) return;

        Tag tag = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag.class) : intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        if (tag == null) return;

        StringBuilder uid = new StringBuilder();
        for (byte b : tag.getId()) {
            if (uid.length() > 0) uid.append(':');
            uid.append(String.format("%02x", b & 0xff));
        }

        JSArray texts = new JSArray();
        try {
            Ndef ndef = Ndef.get(tag);
            NdefMessage msg = ndef != null ? ndef.getCachedNdefMessage() : null;
            if (msg != null) {
                for (NdefRecord r : msg.getRecords()) {
                    byte[] p = r.getPayload();
                    if (p == null || p.length == 0) continue;
                    if (r.getTnf() == NdefRecord.TNF_WELL_KNOWN && java.util.Arrays.equals(r.getType(), NdefRecord.RTD_TEXT)) {
                        int lang = p[0] & 0x3F;
                        if (p.length > 1 + lang) texts.put(new String(p, 1 + lang, p.length - 1 - lang, StandardCharsets.UTF_8));
                    } else if (r.getTnf() == NdefRecord.TNF_WELL_KNOWN && java.util.Arrays.equals(r.getType(), NdefRecord.RTD_URI)) {
                        texts.put(new String(p, 1, p.length - 1, StandardCharsets.UTF_8));
                    }
                }
            }
        } catch (Exception ignored) {
        }

        JSObject out = new JSObject();
        out.put("serial", uid.toString());
        out.put("texts", texts);
        notifyListeners("tag", out, true);
    }
}
