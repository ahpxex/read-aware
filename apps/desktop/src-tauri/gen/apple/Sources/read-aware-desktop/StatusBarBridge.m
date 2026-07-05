// Show/hide the iOS status bar for the reader's immersive view.
//
// Called from Rust (the `set_status_bar_hidden` command) over plain C FFI.
// iOS status-bar visibility is view-controller driven, and the root view
// controller belongs to wry — so instead of subclassing it ahead of time we
// install a `prefersStatusBarHidden` override on its concrete class at
// runtime (idempotent) and trigger an appearance update. On notched devices
// the top safe-area inset survives the hidden bar, so the app's own chrome
// keeps clear of the Dynamic Island.

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

static BOOL raStatusBarHidden = NO;

static BOOL ra_prefersStatusBarHidden(id self, SEL _cmd) {
  return raStatusBarHidden;
}

// `used` + default visibility: Rust resolves this via dlsym at runtime, so
// nothing references it statically and the linker must not dead-strip it.
__attribute__((used, visibility("default")))
void ra_set_status_bar_hidden(bool hidden) {
  dispatch_async(dispatch_get_main_queue(), ^{
    raStatusBarHidden = hidden ? YES : NO;

    UIWindow *window = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) {
        continue;
      }
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      for (UIWindow *candidate in windowScene.windows) {
        if (candidate.isKeyWindow) {
          window = candidate;
          break;
        }
      }
      if (window == nil) {
        window = windowScene.windows.firstObject;
      }
      if (window != nil) {
        break;
      }
    }

    UIViewController *rootViewController = window.rootViewController;
    if (rootViewController == nil) {
      return;
    }

    Class cls = object_getClass(rootViewController);
    SEL selector = @selector(prefersStatusBarHidden);
    if (!class_addMethod(cls, selector, (IMP)ra_prefersStatusBarHidden, "B@:")) {
      Method method = class_getInstanceMethod(cls, selector);
      if (method != NULL) {
        method_setImplementation(method, (IMP)ra_prefersStatusBarHidden);
      }
    }

    [rootViewController setNeedsStatusBarAppearanceUpdate];
  });
}
