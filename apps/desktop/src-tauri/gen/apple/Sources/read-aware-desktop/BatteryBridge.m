// Battery snapshot for the reader header/footer strips.
//
// Called from Rust (the `battery_status` command) over plain C FFI: a
// load-time constructor registers the entry point with the Rust side, since
// release builds strip the export table a runtime symbol lookup would need —
// the same arrangement as StatusBarBridge.m. `UIDevice` battery reads must
// happen on the main thread; the Rust command is sync so it already runs
// there, and the bridge still guards a hop for any future caller that isn't.
// An unreadable level (simulator, monitoring unavailable) writes -1.

#import <UIKit/UIKit.h>

static void ra_battery_status(float *level, bool *charging) {
  __block float resolvedLevel = -1.0f;
  __block BOOL resolvedCharging = NO;
  void (^read)(void) = ^{
    UIDevice *device = UIDevice.currentDevice;
    device.batteryMonitoringEnabled = YES;
    float value = device.batteryLevel;
    // batteryLevel is -1.0 while monitoring reports no usable figure.
    if (value >= 0.0f) {
      resolvedLevel = value;
    }
    UIDeviceBatteryState state = device.batteryState;
    resolvedCharging =
      state == UIDeviceBatteryStateCharging || state == UIDeviceBatteryStateFull;
  };
  if ([NSThread isMainThread]) {
    read();
  } else {
    dispatch_sync(dispatch_get_main_queue(), read);
  }
  if (level != NULL) {
    *level = resolvedLevel;
  }
  if (charging != NULL) {
    *charging = resolvedCharging;
  }
}

// Defined in the Rust crate (src/lib.rs); resolved when the app links libapp.a.
extern void ra_register_battery_bridge(void (*bridge)(float *, bool *));

__attribute__((constructor))
static void ra_install_battery_bridge(void) {
  ra_register_battery_bridge(ra_battery_status);
}
