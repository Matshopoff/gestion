const config = require('../config.json');
const fs = require('fs');

module.exports = (bot) => {
  const eventFiles = fs.readdirSync('./Events/').filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    const event = require(`../Events/${file}`);

    if (event.once) {
      bot.once(event.name, (...args) => event.execute(...args, bot, config));
    } else {
      bot.on(event.name, (...args) => event.execute(...args, bot, config));
    }

    console.log(`[EVENT] > ${file}`);
  }

  const eventSubFolders = fs.readdirSync('./Events/').filter(f => !f.endsWith('.js'));

  for (const folder of eventSubFolders) {
    const subEventFiles = fs.readdirSync(`./Events/${folder}/`).filter(f => f.endsWith('.js'));

    for (const file of subEventFiles) {
      const event = require(`../Events/${folder}/${file}`);

      if (event.once) {
        bot.once(event.name, (...args) => event.execute(...args, bot, config));
      } else {
        bot.on(event.name, (...args) => event.execute(...args, bot, config));
      }

      console.log(`[EVENT] > ${file} - ${folder}`);
    }
  }
};