import { Client } from '../../lib';
import { setModules } from '../collab-helpers';

// run.sh: включить модули (список через запятую) от админа перед замером
await setModules(await Client.login('admin'), process.argv[2]!.split(','));
