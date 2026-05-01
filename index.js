require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { searchItem, getItemDetails } = require('./utils/scraper');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('item')
        .setDescription('Busca un ítem de Lineage 2 High Five')
        .addStringOption(option => 
            option.setName('nombre')
                .setDescription('Nombre del ítem a buscar')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('ayuda')
        .setDescription('Muestra información sobre cómo usar el bot')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    console.log(`Interacción recibida: ${interaction.type} de ${interaction.user.tag}`);
    
    try {
        if (interaction.isChatInputCommand()) {
            console.log(`Comando recibido: ${interaction.commandName} con opciones: ${JSON.stringify(interaction.options.data)}`);
            if (interaction.commandName === 'item') {
                const query = interaction.options.getString('nombre');
                await interaction.deferReply();

                const results = await searchItem(query);
                if (results.length === 0) {
                    return interaction.editReply(`No se encontró ningún ítem relacionado con "${query}".`);
                }

                const item = results[0];
                console.log(`Procesando ítem seleccionado: ${item.name} (${item.url})`);
                const recipeUrls = item.recipeUrls || [];
                const details = await getItemDetails(item.url, recipeUrls);

                if (!details || !details.name) {
                    console.log(`Error: No se pudieron obtener detalles para ${item.url}`);
                    return interaction.editReply('No se pudieron obtener los detalles de este ítem.');
                }

                const embed = createItemEmbed(details);
                const components = buildComponents(details, recipeUrls);

                await interaction.editReply({ embeds: [embed], components });
            } else if (interaction.commandName === 'ayuda') {
                const helpEmbed = new EmbedBuilder()
                    .setTitle('📖 Guía de Uso - L2 Craft BOT')
                    .setDescription('¡Bienvenido! Este bot te ayuda a encontrar recetas, materiales y ubicaciones de drop/spoil para servidores **High Five**.')
                    .setColor(0x00FF00)
                    .addFields(
                        { name: '🔍 Buscar Ítems', value: 'Usa `/item [nombre]` para buscar cualquier objeto. Si el objeto es crafteable, verás su receta.' },
                        { name: '⚔️ Drops y 💎 Spoils', value: 'Al buscar un material, el bot te mostrará los mejores mobs para obtenerlo, con sus porcentajes y cantidades.' },
                        { name: '📍 Ubicaciones', value: 'Debajo de cada mob verás su ubicación en el mapa para que sepas exactamente a dónde ir.' },
                        { name: '📜 Recetas Dinámicas', value: 'Si buscas una pieza de equipo, puedes navegar por sus materiales usando los menús desplegables.' }
                    )
                    .setFooter({ text: 'Creado por roardev | roardev.it@gmail.com' });

                const inviteButton = new ButtonBuilder()
                    .setLabel('Invitar Bot')
                    .setURL(`https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=274878221312&scope=bot%20applications.commands`)
                    .setStyle(ButtonStyle.Link);

                const row = new ActionRowBuilder().addComponents(inviteButton);

                await interaction.reply({ embeds: [helpEmbed], components: [row] });
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_recipe') {
                await interaction.deferUpdate();
                const recipeUrl = interaction.values[0];
                
                // Get the item URL from the current embed
                const currentEmbed = interaction.message.embeds[0];
                const itemUrl = currentEmbed?.url;
                if (!itemUrl) return;
                
                console.log(`Cambiando receta: ${recipeUrl}`);
                const details = await getItemDetails(itemUrl, [recipeUrl]);

                if (!details || !details.name) {
                    return interaction.followUp({ content: 'No se pudieron obtener los detalles de esta receta.', ephemeral: true });
                }

                const embed = createItemEmbed(details);
                
                // Rebuild components: keep the recipe selector from the current message
                const recipeRow = interaction.message.components.find(c => 
                    c.components?.[0]?.customId === 'select_recipe'
                );
                const materialRow = createMaterialSelectRow(details);
                const components = [];
                if (recipeRow) components.push(recipeRow);
                if (materialRow) components.push(materialRow);

                await interaction.editReply({ embeds: [embed], components });
                
            } else if (interaction.customId === 'select_material') {
                await interaction.deferUpdate();
                const materialUrl = interaction.values[0];
                const details = await getItemDetails(materialUrl);

                if (!details || !details.name) {
                    return interaction.followUp({ content: 'No se pudieron obtener los detalles de este material.', ephemeral: true });
                }

                const embed = createItemEmbed(details);
                const materialRow = createMaterialSelectRow(details);

                await interaction.editReply({ embeds: [embed], components: materialRow ? [materialRow] : [] });
            }
        }
    } catch (err) {
        console.error('Error en interacción:', err.message);
        try {
            const reply = interaction.deferred || interaction.replied
                ? interaction.editReply.bind(interaction)
                : interaction.reply.bind(interaction);
            await reply({ content: '❌ Ocurrió un error procesando tu solicitud.', ephemeral: true });
        } catch (e) { /* ignore */ }
    }
});

function createItemEmbed(details) {
    const embed = new EmbedBuilder()
        .setTitle(details.name)
        .setURL(details.url)
        .setColor(0x00AE86)
        .setTimestamp();

    if (details.recipe.length > 0) {
        const lines = details.recipe.map(m => `• **${m.name}** x${m.count}`);
        let chunk = '';
        let fieldIndex = 0;
        for (const line of lines) {
            if ((chunk + '\n' + line).length > 1020) {
                embed.addFields({ name: fieldIndex === 0 ? '📜 Receta / Materiales' : '📜 (cont.)', value: chunk });
                chunk = line;
                fieldIndex++;
            } else {
                chunk = chunk ? chunk + '\n' + line : line;
            }
        }
        if (chunk) {
            embed.addFields({ name: fieldIndex === 0 ? '📜 Receta / Materiales' : '📜 (cont.)', value: chunk });
        }
    }

    if (details.drops.length > 0) {
        const dropText = details.drops.slice(0, 5).map(d => {
            const locName = d.location && d.location !== 'Desconocida' ? d.location.split(',')[0] + (d.location.includes(',') ? '...' : '') : null;
            const loc = locName ? `\n📍 *${locName}*` : '';
            const qty = (d.min === d.max) ? `x${d.min}` : `x${d.min}-${d.max}`;
            return `• **${d.mob}** (${d.level})\n${d.chance} [${qty}]${loc}`;
        }).join('\n\n');
        embed.addFields({ name: '⚔️ Drop (Top 5)', value: dropText || 'N/A', inline: true });
    }

    if (details.spoils.length > 0) {
        const spoilText = details.spoils.slice(0, 5).map(s => {
            const locName = s.location && s.location !== 'Desconocida' ? s.location.split(',')[0] + (s.location.includes(',') ? '...' : '') : null;
            const loc = locName ? `\n📍 *${locName}*` : '';
            const qty = (s.min === s.max) ? `x${s.min}` : `x${s.min}-${s.max}`;
            return `• **${s.mob}** (${s.level})\n${s.chance} [${qty}]${loc}`;
        }).join('\n\n');
        embed.addFields({ name: '💎 Spoil (Top 5)', value: spoilText || 'N/A', inline: true });
    }

    if (details.drops.length === 0 && details.spoils.length === 0 && details.recipe.length === 0) {
        embed.setDescription('No hay información de crafteo o drops disponible para este ítem.');
    }

    embed.setFooter({ text: 'Creado por roardev | roardev.it@gmail.com' });

    return embed;
}

function createRecipeSelectRow(recipeUrls) {
    if (!recipeUrls || recipeUrls.length <= 1) return null;

    const options = recipeUrls.slice(0, 25).map(r => {
        // Extract percentage from name like "Recipe - Dynasty Blade (60%)"
        const pctMatch = r.name.match(/(\d+%)/);
        const pct = pctMatch ? pctMatch[1] : '?%';
        return {
            label: `📜 Receta ${pct}`,
            description: r.name.substring(0, 100),
            value: r.url.substring(0, 100)
        };
    });

    if (options.length === 0) return null;

    const select = new StringSelectMenuBuilder()
        .setCustomId('select_recipe')
        .setPlaceholder('🔄 Selecciona versión de receta')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(select);
}

function createMaterialSelectRow(details) {
    if (details.recipe.length === 0) return null;

    // Deduplicate by URL - combine quantities for duplicate materials
    const seen = new Map();
    for (const m of details.recipe) {
        if (!m.url) continue;
        if (seen.has(m.url)) {
            const existing = seen.get(m.url);
            existing.count = parseInt(existing.count) + parseInt(m.count || 1);
        } else {
            seen.set(m.url, { ...m });
        }
    }

    const options = Array.from(seen.values())
        .slice(0, 25) // Discord limit
        .map(m => ({
            label: m.name.substring(0, 100),
            description: `Cantidad: ${m.count}`,
            value: m.url.substring(0, 100)
        }));

    if (options.length === 0) return null;

    const select = new StringSelectMenuBuilder()
        .setCustomId('select_material')
        .setPlaceholder('🔍 Selecciona un material para ver dónde obtenerlo')
        .addOptions(options);

    return new ActionRowBuilder().addComponents(select);
}

function buildComponents(details, recipeUrls) {
    const components = [];
    const recipeRow = createRecipeSelectRow(recipeUrls);
    if (recipeRow) components.push(recipeRow);
    const materialRow = createMaterialSelectRow(details);
    if (materialRow) components.push(materialRow);
    return components;
}

// Prevent unhandled errors from crashing the bot
client.on('error', err => console.error('Discord client error:', err.message));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err.message || err));

client.login(process.env.DISCORD_TOKEN);
