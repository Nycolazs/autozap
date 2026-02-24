package com.autozap.mobile;

import android.os.Build;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private final Runnable applySystemBarsRunnable = this::applySystemBarsStyle;

  private void scheduleSystemBarsStyle() {
    final View decor = getWindow().getDecorView();
    decor.removeCallbacks(applySystemBarsRunnable);
    decor.post(applySystemBarsRunnable);
    decor.postDelayed(applySystemBarsRunnable, 120);
    decor.postDelayed(applySystemBarsRunnable, 420);
    decor.postDelayed(applySystemBarsRunnable, 900);
  }

  private void applySystemBarsStyle() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

    final int barsColor = Color.parseColor("#FFFFFF");
    final WindowManager.LayoutParams windowAttributes = getWindow().getAttributes();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      windowAttributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
    }
    getWindow().setAttributes(windowAttributes);

    getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
    getWindow().clearFlags(
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        | WindowManager.LayoutParams.FLAG_FULLSCREEN
        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        | WindowManager.LayoutParams.FLAG_LAYOUT_INSET_DECOR
        | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
        | WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
    );
    getWindow().setStatusBarColor(barsColor);
    getWindow().setNavigationBarColor(barsColor);
    getWindow().getDecorView().setBackgroundColor(barsColor);

    final View decor = getWindow().getDecorView();
    int flags = decor.getSystemUiVisibility();
    flags &= ~View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
    flags &= ~View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
    flags &= ~View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
    }
    decor.setSystemUiVisibility(flags);

    final WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decor);
    if (controller != null) {
      controller.setAppearanceLightStatusBars(true);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        controller.setAppearanceLightNavigationBars(true);
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      getWindow().setStatusBarContrastEnforced(false);
      getWindow().setNavigationBarContrastEnforced(false);
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    scheduleSystemBarsStyle();
  }

  @Override
  public void onResume() {
    super.onResume();
    scheduleSystemBarsStyle();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      scheduleSystemBarsStyle();
    }
  }
}
