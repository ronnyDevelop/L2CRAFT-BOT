const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://lineage2wiki.org/hi-five/';

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

async function searchItem(query) {
    try {
        console.log(`Buscando: ${query}...`);
        const response = await axios.get(`${BASE_URL}search/`, {
            params: { q: query },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // The wiki stores results in a JS variable: var itemsList = [...];
        const scripts = $('script').map((i, el) => $(el).html()).get();
        const scriptWithData = scripts.find(s => s && s.includes('var itemsList ='));

        if (scriptWithData) {
            const jsonMatch = scriptWithData.match(/var itemsList = (\[.*?\]);/s);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    const itemsList = JSON.parse(jsonMatch[1]);
                    const results = itemsList
                        .filter(item => item.name.toLowerCase().includes(query.toLowerCase()))
                        .map(item => {
                            // Construct URLs using item_id as fallback if DOM link is missing
                            const domItemLink = $(`a[href*="/item/${item.item_id}/"], a[href*="/recipe/${item.item_id}/"]`).first().attr('href');
                            const itemUrl = domItemLink 
                                ? (domItemLink.startsWith('http') ? domItemLink : `https://lineage2wiki.org${domItemLink}`)
                                : `${BASE_URL}item/${item.item_id}/${slugify(item.name)}/`;
                            
                            // Find ALL matching recipes in the JSON list
                            const recipeItems = itemsList.filter(i => {
                                const ln = i.name.toLowerCase();
                                const itemLower = item.name.toLowerCase();
                                return (ln.startsWith('recipe') && ln.includes(itemLower) && /\d+%/.test(ln));
                            });
                            // Sort: 100% first, then 60%, then others
                            recipeItems.sort((a, b) => {
                                const pctA = parseInt((a.name.match(/(\d+)%/) || ['0','0'])[1]);
                                const pctB = parseInt((b.name.match(/(\d+)%/) || ['0','0'])[1]);
                                return pctB - pctA;
                            });
                            
                            const recipeUrls = recipeItems.map(ri => ({
                                name: ri.name,
                                url: `${BASE_URL}item/${ri.item_id}/${slugify(ri.name)}/`
                            }));
                            
                            return {
                                name: item.name,
                                url: itemUrl,
                                recipeUrls: recipeUrls
                            };
                        });

                    console.log(`Resultados encontrados en JSON: ${results.length}`);
                    if (results.length > 0) return results;
                } catch (e) {
                    console.error('Error al parsear itemsList:', e);
                }
            }
        }

        // Fallback to direct redirect detection
        const itemNameFromH1 = $('h1.txt_title_m3.left_align').text().trim() || $('h1').first().text().trim();
        if (itemNameFromH1 && !itemNameFromH1.toLowerCase().includes('search') && !itemNameFromH1.toLowerCase().includes('búsqueda')) {
            const finalUrl = response.request.res.responseUrl || response.config.url;
            return [{ name: itemNameFromH1, url: finalUrl }];
        }

        console.log('No se encontraron resultados en el JSON ni redirección.');
        return [];
    } catch (error) {
        console.error('Error searching item:', error);
        return [];
    }
}

async function getItemDetails(url, providedRecipeUrls = []) {
    // Normalize: accept string, array of strings, or array of {name, url} objects
    if (typeof providedRecipeUrls === 'string') providedRecipeUrls = [providedRecipeUrls];
    if (!providedRecipeUrls) providedRecipeUrls = [];
    providedRecipeUrls = providedRecipeUrls.map(r => typeof r === 'string' ? r : r.url);
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });
        const html = response.data;
        const $ = cheerio.load(html);

        const scripts = $('script').map((i, el) => $(el).html()).get();

        // 1. Extract Item Info from 'var item'
        let itemData = null;
        const itemScript = scripts.find(s => s && s.includes('var item = {'));
        if (itemScript) {
            const match = itemScript.match(/var item = (\{.*?\});/s);
            if (match) {
                try {
                    itemData = JSON.parse(match[1]);
                } catch (e) { console.error('Error parsing item JSON'); }
            }
        }

        if (!itemData || !itemData.name) {
            console.error('No se pudo encontrar la data del ítem en el script.');
            return null;
        }

        const details = {
            name: itemData.name,
            url: url,
            recipe: [],
            drops: [],
            spoils: []
        };

        // 2. Try to find ingredients (Recipe)
        // Helper: extract ingredients from a page's scripts
        function extractIngredients(pageScripts) {
            const ingScript = pageScripts.find(s => s && s.includes('var ingredients ='));
            if (!ingScript) return null;
            const ingMatch = ingScript.match(/var ingredients = (\[.*?\])/s);
            if (!ingMatch || !ingMatch[1]) return null;
            try {
                return JSON.parse(ingMatch[1]);
            } catch (e) { return null; }
        }

        // Helper: find /recipe/ID/ links on a cheerio page
        function findRecipeLink($page) {
            let best = null;
            $page('a').each((i, el) => {
                const href = $page(el).attr('href') || '';
                const text = $page(el).text().toLowerCase();
                if (/\/recipe\/\d+\//.test(href)) {
                    if (text.includes('100%') || !best) {
                        best = href;
                    }
                }
            });
            return best;
        }

        // Helper: load a URL and return { $, scripts }
        async function loadPage(pageUrl) {
            const res = await axios.get(pageUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $p = cheerio.load(res.data);
            const pScripts = $p('script').map((i, el) => $p(el).html()).get();
            return { $: $p, scripts: pScripts };
        }

        // Helper: normalize a href to a full URL
        function toFullUrl(href) {
            if (!href) return null;
            if (href.startsWith('http')) return href;
            if (href.startsWith('/')) return `https://lineage2wiki.org${href}`;
            return `${BASE_URL}${href}`;
        }

        // Step 2a: Check current page for ingredients
        const currentIngs = extractIngredients(scripts);
        if (currentIngs) {
            console.log(`Ingredientes en página actual: ${currentIngs.length}`);
            details.recipe = currentIngs.map(ing => ({
                name: ing.name,
                count: ing.qty || ing.count || '1',
                url: `${BASE_URL}item/${ing.item_id}/${slugify(ing.name)}/`
            }));
        }

        // Step 2b: If no ingredients yet, find the recipe page
        if (details.recipe.length === 0) {
            // Priority 1: /recipe/ID/ link on the item page
            let recipeHref = findRecipeLink($);
            
            // Build list of URLs to try: page link first, then all provided URLs
            const urlsToTry = [];
            if (recipeHref) urlsToTry.push(recipeHref);
            for (const pUrl of providedRecipeUrls) {
                if (!urlsToTry.includes(pUrl)) urlsToTry.push(pUrl);
            }

            // Try each URL, with up to 2 hops per URL
            const visited = new Set();
            for (const startUrl of urlsToTry) {
                if (details.recipe.length > 0) break;
                let currentHref = startUrl;

            for (let hop = 0; hop < 2 && currentHref && details.recipe.length === 0; hop++) {
                const fullUrl = toFullUrl(currentHref);
                if (!fullUrl || visited.has(fullUrl)) break;
                visited.add(fullUrl);

                console.log(`[Hop ${hop + 1}] Cargando: ${fullUrl}`);
                try {
                    const page = await loadPage(fullUrl);
                    
                    // Try to extract ingredients
                    const ings = extractIngredients(page.scripts);
                    if (ings) {
                        console.log(`✅ Ingredientes encontrados: ${ings.length}`);
                        details.recipe = ings.map(ing => ({
                            name: ing.name,
                            count: ing.qty || ing.count || '1',
                            url: `${BASE_URL}item/${ing.item_id}/${slugify(ing.name)}/`
                        }));
                    } else {
                        // No ingredients here, look for a /recipe/ID/ link to follow
                        const nextHref = findRecipeLink(page.$);
                        if (nextHref) {
                            console.log(`➡️ Siguiendo enlace a receta: ${nextHref}`);
                            currentHref = nextHref;
                        } else {
                            // Try extracting recipe_id from the page's var item (recipe scroll pages have this)
                            const pageItemScript = page.scripts.find(s => s && s.includes('var item = {'));
                            if (pageItemScript) {
                                const itemMatch = pageItemScript.match(/var item = (\{.*?\});/s);
                                if (itemMatch) {
                                    try {
                                        const pageItem = JSON.parse(itemMatch[1]);
                                        if (pageItem.recipe_id && parseInt(pageItem.recipe_id) > 1) {
                                            console.log(`🔑 recipe_id encontrado: ${pageItem.recipe_id}`);
                                            currentHref = `/hi-five/recipe/${pageItem.recipe_id}/`;
                                            continue;
                                        }
                                    } catch (e) { /* ignore parse error */ }
                                }
                            }
                            console.log(`❌ No se encontraron ingredientes ni enlaces a receta.`);
                            currentHref = null;
                        }
                    }
                } catch (e) {
                    console.error(`Error cargando ${fullUrl}:`, e.message);
                    break;
                }
                }
            } // end for startUrl
        } // end if recipe.length === 0
        // 3. Extract Mobs (Drops/Spoils) from 'var mobs'
        const mobScript = scripts.find(s => s && s.includes('var mobs ='));
        if (mobScript) {
            const mobMatch = mobScript.match(/var mobs = (\[.*?\]);/s);
            if (mobMatch) {
                try {
                    const mobsArr = JSON.parse(mobMatch[1]);
                    mobsArr.forEach(m => {
                        const entry = {
                            mob: m.name,
                            level: m.level,
                            chance: m.chance + '%'
                        };
                        if (m.type === 'spoil') details.spoils.push(entry);
                        else details.drops.push(entry);
                    });
                } catch (e) { }
            }
        }

        return details;
    } catch (error) {
        console.error('Error getting item details:', error);
        return null;
    }
}

module.exports = {
    searchItem,
    getItemDetails
};
