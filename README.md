# L2 High Five Crafting Bot

Discord Bot que extrae información de crafteo, recetas y drops directamente de [lineage2wiki.org](https://lineage2wiki.org/hi-five/).

## Requisitos

- [Node.js](https://nodejs.org/) (v16.11.0 o superior)
- Un Bot de Discord (Token y Client ID)

## Instalación

1.  Clona o descarga este repositorio.
2.  Abre una terminal en la carpeta del proyecto.
3.  Instala las dependencias:
    ```bash
    npm install
    ```
4.  Crea un archivo `.env` basado en `.env.example` y rellena tus datos:
    ```env
    DISCORD_TOKEN=TU_TOKEN_AQUI
    CLIENT_ID=TU_CLIENT_ID_AQUI
    ```

## Uso

1.  Inicia el bot:
    ```bash
    node index.js
    ```
2.  En Discord, usa el comando `/item [nombre]` (ejemplo: `/item Draconic Bow`).
3.  El bot responderá con la receta. Podrás seleccionar cualquier material del menú desplegable para ver sus drops y spoils.

## Notas

El bot realiza scraping en tiempo real para asegurar que la información esté actualizada. Si la wiki cambia su estructura, es posible que el scraper necesite una actualización.
