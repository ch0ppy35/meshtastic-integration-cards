// Bundle entry point. HACS registers this single file as one Lovelace
// resource; every card it imports becomes available in the card picker.

import packageJson from '../package.json' with { type: 'json' };
import { DEV } from './register';

import './chat-card';
import './radio-card';

// eslint-disable-next-line no-console
console.info(
  `%c Meshtastic Cards${DEV ? ' DEV' : ''} \n%c Version v${packageJson.version}`,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);
