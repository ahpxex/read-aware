// iOS exports: the dialog plugin's save picker cannot deliver content there —
// it writes an empty file into Documents and copies it during presentation,
// before the app has produced anything. Instead Rust stages the finished file
// and this bridge presents a UIDocumentPickerViewController in export mode:
// the user picks a destination and the staged copy lands there.
//
// Called from Rust (src/export_pick.rs) over plain C FFI. A load-time
// constructor hands the entry point over, since release builds strip the
// export table a runtime symbol lookup would need (see FolderPickBridge.m).
// The delegate reports by calling ra_export_pick_finished directly:
// 0 exported, 1 cancelled, 2 error — no parking, no polling.

#import <UIKit/UIKit.h>
#include <stdint.h>

// Defined in the Rust crate (src/export_pick.rs); resolved when the app links libapp.a.
extern void ra_export_pick_finished(uint64_t pickId, int32_t status, const char *error);
extern void ra_register_export_pick_bridge(void (*start)(uint64_t, const char *));

// UIDocumentPickerViewController's delegate is weak, so each pick keeps its
// own delegate alive in this map until its outcome arrives.
static NSMutableDictionary<NSNumber *, NSObject *> *raExportPickDelegates;

@interface RAExportPickDelegate : NSObject <UIDocumentPickerDelegate>
@property(nonatomic) uint64_t pickId;
@end

@implementation RAExportPickDelegate
- (void)ra_finish:(int32_t)status error:(const char *)error {
  uint64_t pickId = self.pickId;
  ra_export_pick_finished(pickId, status, error);
  @synchronized(raExportPickDelegates) {
    [raExportPickDelegates removeObjectForKey:@(pickId)];
  }
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller
    didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  if (urls.firstObject == nil) {
    [self ra_finish:2 error:"export produced no destination"];
    return;
  }
  [self ra_finish:0 error:NULL];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  [self ra_finish:1 error:NULL];
}
@end

static UIViewController *ra_export_presenting_controller(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (!window.isKeyWindow) continue;
      UIViewController *controller = window.rootViewController;
      while (controller.presentedViewController != nil) controller = controller.presentedViewController;
      return controller;
    }
  }
  return nil;
}

static void ra_export_pick_start(uint64_t pickId, const char *path) {
  NSString *filePath = path == NULL ? nil : [NSString stringWithUTF8String:path];
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *presenter = ra_export_presenting_controller();
    if (presenter == nil || filePath == nil) {
      ra_export_pick_finished(pickId, 2,
                              filePath == nil ? "invalid staged path" : "no window to present from");
      return;
    }
    RAExportPickDelegate *delegate = [RAExportPickDelegate new];
    delegate.pickId = pickId;
    @synchronized(raExportPickDelegates) {
      raExportPickDelegates[@(pickId)] = delegate;
    }
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc]
        initForExportingURLs:@[ [NSURL fileURLWithPath:filePath] ]
                      asCopy:YES];
    picker.delegate = delegate;
    [presenter presentViewController:picker animated:YES completion:nil];
  });
}

__attribute__((constructor)) static void ra_install_export_pick_bridge(void) {
  raExportPickDelegates = [NSMutableDictionary new];
  ra_register_export_pick_bridge(ra_export_pick_start);
}
