import { Client } from '../../lib';
import { setModules } from '../collab-helpers';

// run.sh: enable modules (comma-separated list) by admin before the measurement
await setModules(await Client.login('admin'), process.argv[2]!.split(','));
