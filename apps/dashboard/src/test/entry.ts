/// <reference types="vite/client" />
// test-ui/index.html's first script, ahead of the desk. No build input includes it.
import { loadManifest } from '../manifest';
import { installHarness } from './harness';

const manifest = loadManifest();
installHarness(manifest.status === 'ready' && manifest.source === 'deployed' ? manifest.manifest : null);
