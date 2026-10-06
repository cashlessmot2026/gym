package com.ironyellow.gym;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RemoteButtonPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Botones de controles Bluetooth → contador de la app (sólo mientras se entrena). */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (RemoteButtonPlugin.handle(event)) return true;
        return super.dispatchKeyEvent(event);
    }
}
