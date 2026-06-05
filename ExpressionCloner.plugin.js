/**
 * @name ExpressionCloner
 * @author Narukami
 * @description Clone Emotes and Stickers. Port of [Vencord](https://github.com/Vendicated/Vencord/blob/main/src/plugins/expressionCloner/index.tsx)
 * @version 0.0.0
 * @source https://github.com/Naru-kami/EmoteAdder
 */

module.exports = (meta) => {
  const { React, Webpack, Webpack: { Filters, Stores }, ContextMenu, Logger } = BdApi;
  /** @type {typeof import("react")} */
  const { createElement: jsx, useRef, Fragment } = React;

  const cleanups = new Set();
  const internals = { isInitialized: false };
  var ctrl;


  function init() {
    if (internals.isInitialized) return;

    Object.assign(internals, {
      ...Webpack.getBulkKeyed({
        contextMenuClass: { firstId: 32271, filter: Filters.byKeys("scroller", "label") },
        ImageInputWithModals: { firstId: 891812, filter: Filters.byStrings("?.activateUploadDialogue()"), searchExports: true }
      })
    })
    console.log(internals)
    Logger.log(meta.slug, "Initialized");
  }

  function start() {
    init();

    cleanups.add(ContextMenu.patch("message", (children, props) => {
      const { id, name, type } = props.target.dataset;
      const src = props.target.src;
      const menuGroup = children.props.children.props.children.at(-1)?.props.children.at(0)?.props.children;

      if (!id || !menuGroup) return;

      if (type === "emoji") {
        const match = props.message.content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>|https://cdn\\.discordapp\\.com/emojis/${id}\\.`));
        const reaction = props.message.reactions.find(reaction => reaction.emoji.id === id);
        if (!match && !reaction) return;

        const emojiname = match?.[1] ?? reaction?.emoji.name ?? name ?? "emoji";
        menuGroup.push(Components.MenuItem(type, { id, name: emojiname, src }));
      } else if (type === "sticker") {

      }
    }));

    cleanups.add(ContextMenu.patch("expression-picker", (children, props) => {
      console.log(children, props)
    }))
  }

  function stop() {
    BdApi.Patcher.unpatchAll(meta.slug);
    ctrl?.abort();
    cleanups.forEach(cleanup => cleanup());
    cleanups.clear();
  }

  const Utils = {
    /** @template T @param {...T} classNames */
    clsx(...classNames) { return classNames.filter(Boolean).join(" ") },

    toCapitalCase(str) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    },

    srcIsAnimated(src) {
      const u = new URL(src);
      return u.pathname.endsWith(".gif") || u.searchParams.get("animated") === "true";
    },

    getUrl(data, size) {
      if (data.t === "Emoji")
        return `${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/emojis/${data.id}.webp?size=${size}&lossless=true&animated=true`;

      return `${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${data.id}.${StickerExtMap[data.format_type]}?size=${size}&lossless=true&animated=true`;
    },

    getGuildCandidates(expression) {
      const meId = Stores.UserStore.getCurrentUser().id;
      const PermissionsBits = Webpack.getById(652215).xBc;
      const getGuildMaxEmojiSlots = Webpack.getById(473145).sN;
      const getGuildMaxStickerSlots = Webpack.getById(473145).aG;

      return Object.values(Stores.GuildStore.getGuilds()).filter(g => {
        const canCreate = g.ownerId === meId ||
          (Stores.PermissionStore.getGuildPermissions({ id: g.id }) & PermissionsBits.CREATE_GUILD_EXPRESSIONS) === PermissionsBits.CREATE_GUILD_EXPRESSIONS;
        if (!canCreate) return false;

        if (expression.type === "Sticker") {
          const stickerSlots = getGuildMaxStickerSlots(g.premiumTier, g);
          const stickers = Stores.StickersStore.getStickersByGuildId(g.id);

          return !stickers || stickers.length < stickerSlots;
        }

        const { isAnimated } = expression;

        const emojiSlots = getGuildMaxEmojiSlots(g);
        const emojis = Stores.EmojiStore.getGuildEmoji(g.id);

        let count = 0;
        for (const emoji of emojis) {
          if (emoji.animated === isAnimated && !emoji.managed) {
            count++;
          }
        }

        return count < emojiSlots;
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const Components = {
    MenuItem(type, expression) {
      return jsx(ContextMenu.Item, {
        label: `Clone ${Utils.toCapitalCase(type)}`,
        id: `clone-${type}`,
        action: async () => {
          if (type === "emoji") {
            const resp = await fetch(expression.src);
            const blob = await resp.blob();
            const dataUrl = await new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            })
            const isAnimated = Utils.srcIsAnimated(expression.src);
            BdApi.Webpack.getById(644508).f({
              userImage: {
                isAnimated: isAnimated,
                data: dataUrl,
                file: new File([blob], expression.name, { type: blob.type }),
              }
            })
          }
          // console.log(Utils.getGuildCandidates({ type, isAnimated: false }))
        }
      })
    }
  }

  return { start, stop }
}
