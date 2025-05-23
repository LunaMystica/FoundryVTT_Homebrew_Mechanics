export const endurance_broken_effect = {
  name: 'Endurance broken',
  img: 'https://assets.forge-vtt.com/66533e95d1aabfaaeb681fae/Icons/Ability/Ability_Warrior_ShieldBreak.webp',
  type: 'base',
  statuses: ['prone'],
  flags: {
    dae: {
      specialDuration: ['turnStart'],
    },
    effectmacro: {
      onDelete: {
        script: `
          const enduranceItem = actor.items.getName("Endurance");
          await chrisPremades.utils.genericUtils.update(enduranceItem, {'system.uses.spent': 0});
        `.trim(),
      },
    },
  },
};
