package ch.duartesantos.opengym;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The Google Play install referrer: the "referrer" a store link carried
 * (play.google.com/store/apps/details?id=…&referrer=ref%3DLUCIA), read on the app's first start so
 * a creator's code reaches the sign-up without anyone typing it (lib/install-referrer.js).
 * Play keeps it for 90 days after the install; outside Play (a sideloaded APK) there is none.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const InstallReferrer = registerPlugin('InstallReferrer');
 *   const { referrer } = await InstallReferrer.get();   // null when there is none
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        final AtomicBoolean answered = new AtomicBoolean(false);
        final InstallReferrerClient client;
        try {
            client = InstallReferrerClient.newBuilder(getContext()).build();
        } catch (Exception e) {
            call.resolve(none());
            return;
        }
        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    if (answered.getAndSet(true)) return;
                    JSObject out = none();
                    try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            ReferrerDetails details = client.getInstallReferrer();
                            String referrer = details.getInstallReferrer();
                            out.put("referrer", referrer == null ? JSObject.NULL : referrer);
                            out.put("clickedAt", details.getReferrerClickTimestampSeconds());
                            out.put("installedAt", details.getInstallBeginTimestampSeconds());
                        }
                    } catch (Exception e) {
                        // No referrer rather than an error: the app works the same without one.
                    } finally {
                        try { client.endConnection(); } catch (Exception ignored) { }
                    }
                    call.resolve(out);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    if (answered.getAndSet(true)) return;
                    call.resolve(none());
                }
            });
        } catch (Exception e) {
            if (!answered.getAndSet(true)) call.resolve(none());
        }
    }

    private static JSObject none() {
        JSObject out = new JSObject();
        out.put("referrer", JSObject.NULL);
        return out;
    }
}
