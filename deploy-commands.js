const { REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
    console.log(`✅ Carregado: ${command.data.name}`);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`\n🔄 Registrando ${commands.length} comandos slash...\n`);

        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        console.log(`\n✅ ${data.length} comandos registrados com sucesso!\n`);
        
        console.log('📋 Comandos registrados:');
        data.forEach(cmd => {
            console.log(`   /${cmd.name} - ${cmd.description}`);
        });

    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
})();
