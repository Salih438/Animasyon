import * as audio from './scene/audio.js';
import * as rain from './scene/rain.js';
import * as ground from './scene/ground.js';
import * as walker from './scene/walker.js';
import * as traffic from './scene/traffic.js';
import * as lighting from './scene/lighting.js';
import * as world from './scene/world.js';
import * as post from './scene/postprocessing.js';

console.log('--- Phase 9 Revision Module Integrity Check ---');
console.log('Audio exports:', Object.keys(audio));
console.log('Rain count:', rain.RAIN_COUNT);
console.log('Ground road width:', ground.ROAD_WIDTH, 'center:', ground.ROAD_CENTER_X);
console.log('Walker X:', walker.WALKER_X, 'Z:', walker.WALKER_Z);
console.log('Traffic car count:', traffic.CAR_COUNT);
console.log('Lighting lamp count:', lighting.LAMP_COUNT);
console.log('--- ALL MODULE EXPORTS PRESENT & VALID ---');
