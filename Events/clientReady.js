const { ActivityType } = require('discord.js');

module.exports = {
  name: 'clientReady',

  async execute(bot) {

    // =====================================================
    // PRÉSENCE DU BOT
    // =====================================================

    bot.user.setPresence({
      status: 'dnd',
      activities: [
        {
          name: '',
          type: ActivityType.Play,
          url: 'https://twitch.tv/4wipyk'
        }
      ]
    });

    console.log('[PRESENCE] Présence mise à jour');

    // =====================================================
    // SYNCHRONISATION DES PANELS DE TICKETS
    // =====================================================

    try {
      const ticket = require('../Commands/Contact/ticket.js');

      await ticket.syncAllPanels(bot);

      console.log('[TICKET] Panels synchronisés au démarrage');
    } catch (error) {
      console.error(
        '[TICKET] Erreur lors de la synchronisation des panels :',
        error
      );
    }
  }
};
