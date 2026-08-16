package np.com.phit.lms2;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean nativeBridgeRegistered = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Re-apply the launch theme before the activity window is created so
        // MIUI/Redmi cannot replace it with a blank preview.
        setTheme(R.style.AppTheme_NoActionBarLaunch);
        super.onCreate(savedInstanceState);
        // MIUI often ignores windowSplashScreenAnimatedIcon and only paints
        // the window background. Pin the centered-logo drawable here as well.
        getWindow().setBackgroundDrawableResource(R.drawable.splash);
        enableEdgeToEdge();
        registerNativeAppBridge();
    }

    /** Expose installed versionCode to the WebView for the update prompt. */
    private void registerNativeAppBridge() {
        if (nativeBridgeRegistered) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().addJavascriptInterface(new PhitNativeAppBridge(), "PhitNativeApp");
        nativeBridgeRegistered = true;
    }

    private class PhitNativeAppBridge {
        @JavascriptInterface
        public String getVersionCode() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return String.valueOf(
                        getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode()
                    );
                }
                return String.valueOf(getPackageManager().getPackageInfo(getPackageName(), 0).versionCode);
            } catch (Exception error) {
                return "0";
            }
        }

        @JavascriptInterface
        public String getVersionName() {
            try {
                String name = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                return name != null ? name : "";
            } catch (Exception error) {
                return "";
            }
        }

        @JavascriptInterface
        public String getPackageName() {
            return MainActivity.this.getPackageName();
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        // SplashScreen teardown sets decorFitsSystemWindows(true) after an
        // immersive launch splash. Re-apply edge-to-edge so the WebView
        // keeps the full screen on MIUI / ColorOS.
        enableEdgeToEdge();
        registerNativeAppBridge();
    }

    @Override
    public void onResume() {
        super.onResume();
        enableEdgeToEdge();
    }

    /**
     * Draw the WebView behind the status / navigation bars and into display
     * cutouts. CSS env()/--safe-area-inset-* then pad the header and content
     * so nothing is clipped or double-spaced (Redmi, Oppo, Android 15+).
     */
    private void enableEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        View decor = getWindow().getDecorView();
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), decor);
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }
}
