package com.ironyellow.gym;

import android.view.KeyEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Captura los botones de cualquier control Bluetooth emparejado con el teléfono
 * (botón disparador de selfie, auriculares, teclados, botones BLE tipo HID) y los
 * envía a la app web para detener el contador. Sólo intercepta mientras la app lo pide
 * (durante un ejercicio), así el volumen funciona normal el resto del tiempo.
 */
@CapacitorPlugin(name = "RemoteButton")
public class RemoteButtonPlugin extends Plugin {
    static RemoteButtonPlugin instance;
    static volatile boolean capturing = false;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void enable(PluginCall call) {
        capturing = true;
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        capturing = false;
        call.resolve();
    }

    static boolean isRemoteKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
            case KeyEvent.KEYCODE_CAMERA:
            case KeyEvent.KEYCODE_FOCUS:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_SPACE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_BUTTON_1:
            case KeyEvent.KEYCODE_DPAD_CENTER:
                return true;
            default:
                return false;
        }
    }

    /** Llamado desde MainActivity. Devuelve true si consumió la tecla. */
    static boolean handle(KeyEvent event) {
        if (!capturing || instance == null || !isRemoteKey(event.getKeyCode())) return false;
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            JSObject data = new JSObject();
            data.put("key", KeyEvent.keyCodeToString(event.getKeyCode()));
            instance.notifyListeners("press", data);
        }
        return true;
    }
}
