const feats = {
	ACID: 'vNpeYMAZeQDvOvtR',
	BLUDGEONING: 'aDbYsBcUo4T5mP9A',
	COLD: 'GWlusg6yYmK3FWh8',
	FIRE: 'GgU8fh91yYKUGzMk',
	FORCE: 'cAWCUo3w7RDdfmP6',
	LIGHTNING: 'ovGlTmYdP0cXK6P5',
	NECROTIC: '7JVONmq5bvg4S8RW',
	PIERCING: 'aDbYsBcUo4T5mP9A',
	POISON: 'vNpeYMAZeQDvOvtR',
	PSYCHIC: 'VtGCpTCZAs1CfaKH',
	RADIANT: 'idNukDdEPuOZLuzy',
	SLASHING: 'aDbYsBcUo4T5mP9A',
	THUNDER: 'Fgw6nIYPw3DIhemf',
};

const compendium_base = 'Compendium.my-shared-compendia.feats.Item';

export const damageTypeFeatures = Object.fromEntries(Object.entries(feats).map(([type, id]) => [type.toLowerCase(), `${compendium_base}.${id}`]));

