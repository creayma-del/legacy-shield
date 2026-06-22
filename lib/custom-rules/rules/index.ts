import type { ShieldRule } from '../../types.js';
import noDangerousApis from './no-dangerous-apis.js';
import noLargeLoops from './no-large-loops.js';
import noExpensiveWatcher from './no-expensive-watcher.js';
import noSyncStorageInLoop from './no-sync-storage-in-loop.js';
import noLeakedListener from './no-leaked-listener.js';
import noUnclearedTimer from './no-uncleared-timer.js';
import noLargeResource from './no-large-resource.js';
import noSyncScript from './no-sync-script.js';

export const RULE_IMPLEMENTATIONS: Record<string, ShieldRule> = {
  'no-dangerous-apis': noDangerousApis,
  'no-large-loops': noLargeLoops,
  'no-expensive-watcher': noExpensiveWatcher,
  'no-sync-storage-in-loop': noSyncStorageInLoop,
  'no-leaked-listener': noLeakedListener,
  'no-uncleared-timer': noUnclearedTimer,
  'no-large-resource': noLargeResource,
  'no-sync-script': noSyncScript,
};
