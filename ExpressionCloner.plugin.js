/**
 * @name ExpressionCloner
 * @author Narukami
 * @description Clone Emotes and Stickers. Port of [Vencord/plugins/expressionCloner](https://github.com/Vendicated/Vencord/blob/main/src/plugins/expressionCloner/index.tsx)
 * @version 0.0.0
 * @source https://github.com/Naru-kami/ExpressionCloner
 */

module.exports = (meta) => {
  /** @type {{React: typeof import("react")}} */
  const { React, Webpack, Webpack: { Filters, Stores }, ContextMenu, Logger, UI } = BdApi;
  const { createElement: jsx, useState, useRef, useEffect, useMemo, useCallback, useTransition } = React;

  const cleanups = new Set();
  const internals = { isInitialized: false };

  function init() {
    if (internals.isInitialized) return;

    Object.assign(internals, {
      isInitialized: true,
      ...Webpack.getBulkKeyed({
        modalAPI: { firstId: 192308, filter: Filters.bySource(".modalKey?") },
        getGuildMaxEmojiSlots: { firstId: 473145, filter: Filters.byStrings(".premiumFeatures?.additionalEmojiSlots??0"), searchExports: true },
        getGuildMaxStickerSlots: { firstId: 473145, filter: Filters.byStrings(".GuildFeatures.MORE_STICKERS)&&"), searchExports: true },
        uploadEmoji: { firstId: 554375, filter: Filters.byStrings(".GUILD_EMOJIS(", "EMOJI_UPLOAD_START"), searchExports: true },
        emojiAPI: { firstId: 690521, filter: Filters.byKeys("sanitizeEmojiName") },
        Endpoints: { firstId: 652215, filter: Filters.byKeys("MESSAGE_CROSSPOST"), searchExports: true },
        PermissionsBits: { firstId: 652215, filter: Filters.byKeys("CREATE_GUILD_EXPRESSIONS"), searchExports: true },

        FormSelect: { firstId: 691885, filter: Filters.byStrings("horizontalControlColumnWidth:`min("), searchExports: true },
        ManaButton: { firstId: 657718, filter: Filters.byStrings(".BUTTON_LOADING_STARTED_LABEL,"), searchExports: true },
        Modal: { firstId: 189213, filter: Filters.byKeys("Modal") },
        TextInput: { firstId: 292666, filter: Filters.byStrings('"data-mana-component":"text-input"'), searchExports: true },
        GuildIcon: { firstId: 548118, filter: Filters.byStrings('"top",badgeStrokeColor:') },
      }),
      ...Webpack.getMangled(Filters.bySource(".failImmediatelyWhenRateLimited)"), {
        restAPI: Filters.byKeys("get", "del")
      }, { firstId: 636537 })
    })

    Logger.log(meta.slug, "Initialized");
  }

  function start() {
    init();

    cleanups.add(ContextMenu.patch("message", (children, props) => {
      const { id, name, type } = props?.target?.dataset ?? {};
      const menuGroup = children?.props?.children?.props?.children?.at(-1)?.props?.children?.at(0)?.props?.children ?? children?.props?.children?.props?.children;

      if (!id || !menuGroup) return;

      if ("emoji" === type) {
        const match = props.message.content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>|https://cdn\\.discordapp\\.com/emojis/${id}\\.`));
        const reaction = props.message.reactions.find(reaction => reaction.emoji.id === id);
        const src = props?.target?.src;
        if (!match && !reaction || !src) return;

        menuGroup.push(Components.MenuItem("Emoji", () => ({
          id,
          name: match?.[1] ?? reaction?.emoji.name ?? name ?? "emoji",
          isAnimated: Utils.srcIsAnimated(src)
        })));
      } else if ("sticker" === type) {
        const sticker = props.message.stickerItems.find(s => s.id === id);
        if (sticker?.format_type === 3 /* LOTTIE */) return;

        menuGroup.push(Components.MenuItem("Sticker", () => Utils.fetchSticker(sticker.id)));
      }
    }));

    cleanups.add(ContextMenu.patch("expression-picker", (children, props) => {
      const { id, name, type } = props?.target?.dataset ?? {};
      const menuGroup = children?.props?.children?.props?.children;

      if (!id || !menuGroup) return;

      if (type === "emoji") {
        const src = props?.target?.firstChild?.src;

        menuGroup.splice(1, 0, Components.MenuItem("Emoji", () => ({
          id,
          name,
          isAnimated: src && Utils.srcIsAnimated(src)
        })));
      } else if (type === "sticker" && !props.target.className?.includes("lottieCanvas")) {
        menuGroup.splice(1, 0, Components.MenuItem("Sticker", () => Utils.fetchSticker(id)));
      }
    }));
  }

  function stop() {
    cleanups.forEach(cleanup => cleanup());
    cleanups.clear();
  }

  const Utils = {
    StickerExtMap: /** @type {const} */ ({ 1: "png", 2: "png", 3: "json", 4: "gif" }),

    /** @template T @param {...T} classNames */
    clsx(...classNames) { return classNames.filter(Boolean).join(" ") },

    /** @param {string} src */
    srcIsAnimated(src) {
      const url = new URL(src);
      return url.pathname.endsWith(".gif") || url.searchParams.get("animated") === "true";
    },

    /** @param {Expression} data @param {number} size  */
    getUrl(data, size) {
      if ("Emoji" === data.expression)
        return `${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/emojis/${data.id}.webp?size=${size}&lossless=true&animated=true`;

      return `${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${data.id}.${Utils.StickerExtMap[data.format_type]}?size=${size}&lossless=true&animated=true`;
    },

    /** @param {string} id */
    async fetchSticker(id) {
      const cached = Stores.StickersStore.getStickerById(id);
      if (cached) return cached;

      const { body } = await internals.restAPI.get({
        url: internals.Endpoints.STICKER(id)
      });

      Stores.UserStore._dispatcher.dispatch({
        type: "STICKER_FETCH_SUCCESS",
        sticker: body
      });

      return body;
    },

    /** @param {Expression} data */
    async fetchBlob(data) {
      //                                   MAX_STICKER_SIZE_BYTES : MAX_EMOJI_SIZE_BYTES
      const MAX_SIZE = "Sticker" === data.expression ? 512 * 1024 : 256 * 1024;

      for (let size = 4096; size >= 16; size >>= 1) {
        const url = Utils.getUrl(data, size);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url} with HTTP status code ${res.status}`);
        }

        const blob = await res.blob();
        if (blob.size <= MAX_SIZE) {
          return blob;
        }
      }

      throw new Error(`Failed to fetch ${data.expression} within the size limit of ${MAX_SIZE / 1024}KiB`);
    },

    /** @param {string} guildId @param {Sticker} sticker */
    async cloneSticker(guildId, sticker) {
      const data = new FormData();
      data.append("name", sticker.name);
      data.append("tags", sticker.tags);
      data.append("description", sticker.description);
      data.append("file", await Utils.fetchBlob(sticker));

      const { body } = await internals.restAPI.post({
        url: internals.Endpoints.GUILD_STICKER_PACKS(guildId),
        body: data
      });

      Stores.UserStore._dispatcher.dispatch({
        type: "GUILD_STICKERS_CREATE_SUCCESS",
        guildId,
        sticker: {
          ...body,
          user: Stores.UserStore.getCurrentUser()
        }
      });
    },

    /** @param {string} guildId @param {Emoji} emoji */
    async cloneEmoji(guildId, emoji) {
      const blob = await Utils.fetchBlob(emoji);

      const dataUrl = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      return internals.uploadEmoji({
        guildId,
        name: emoji.name.split("~")[0],
        image: dataUrl
      });
    },

    /** @param {string} guildId @param {Expression} data */
    async cloneExpression(guildId, data) {
      try {
        if ("Sticker" === data.expression) {
          await Utils.cloneSticker(guildId, data);
        } else if ("Emoji" === data.expression) {
          await Utils.cloneEmoji(guildId, data);
        } else {
          throw new Error("Unknown expression");
        }

        UI.showToast(`Successfully cloned ${data.name} to ${Stores.GuildStore.getGuild(guildId)?.name ?? "your server"}.`, { type: 'success' })
      } catch (e) {
        UI.showToast(`Failed to clone ${data.name}.`)
        Logger.error(meta.slug, `Failed to clone ${data.name} to ${guildId}`, e);
      }
    }
  }

  const Components = {
    /** @param {React.PropsWithChildren<{fallback?: React.ReactNode}>} props */
    ErrorBoundary({ fallback, ...restProps }) {
      return jsx(BdApi.Components.ErrorBoundary, {
        ...restProps,
        fallback: fallback ?? jsx("div", { style: { color: "var(--red-430, #d6363f)" } }, "Component Error")
      })
    },

    /** @typedef {{ id: string, name: string, isAnimated: boolean }} Emoji */
    /**
     * @typedef {{
     *  asset?: string; available: boolean; description: string; format_type: 1 | 2 | 3 | 4;
     *  guild_id: string; id: string; name: string; tags: string; type: 2; sort_value?: number;
     * }} Sticker
     */
    /** @typedef {{expression: "Sticker"} & Sticker | {expression: "Emoji"} & Emoji } Expression */
    /** @param {"Emoji" | "Sticker"} type @param {() => Promise<Sticker | Emoji>} fetchData */
    MenuItem(type, fetchData) {
      return jsx(ContextMenu.Item, {
        label: `Clone ${type}`,
        id: `Clone-${type}`,
        key: `Clone-${type}`,
        action: () => {
          internals.modalAPI?.openModalLazy(async () => {
            const res = await fetchData();
            const data = { expression: type, ...res };
            const url = Utils.getUrl(data, 128);

            return modalProps => jsx(Components.ErrorBoundary, null,
              jsx(internals.Modal.Modal, {
                ...modalProps,
                size: "lg",
                title: `Clone ${data.name}`,
                children: jsx(Components.ClonerModal, { data, url }),
              })
            );
          })
        }
      })
    },

    /** @param {{data: Expression, url: string}} props */
    ClonerModal({ data, url }) {
      const [isPending, startTransition] = useTransition();
      const [emojiName, setEmojiName] = useState(data.name);
      const [selectedGuildId, setSelectedGuildId] = useState(() => Stores.SelectedGuildStore.getGuildId());
      const [error, setError] = useState(null);

      const handleNameChange = useCallback(name => {
        data.name = name;
        setEmojiName(name);
      }, [data]);

      return jsx("div", {
        children: [
          jsx("style", null, `@scope {
            :scope {
              display: grid;
              grid-template-columns: min-content 1fr;
              gap: 16px;
            }
            .formfield {
              display: grid;
              gap: 8px;
            }
            .separator {
              margin-block: 16px;
              height: 1px;
              background-color: #fff2;
            }
            .preview {
              aspect-ratio: 1;
              background-color: var(--background-base-lower);
              border: 1px solid var(--border-subtle);
              border-radius: var(--radius-sm);
              box-sizing: border-box;
              display: grid;
              place-items: center;

              &.Emoji img {
                max-height: min(100%, 48px);
                max-width: min(100%, 48px);
              }
              
              &.Sticker img {
                max-height: min(100%, 160px);
                max-width: min(100%, 160px);
              }
            }
            [data-mana-component="select-input-field"] + [aria-hidden="true"] {
              position: fixed !important;
            }
          }`),
          jsx(Components.ExpressionPreview, { data, url }),
          jsx("div", { className: "formfield" },
            jsx(Components.NameInput, {
              label: `${data.expression} name`,
              name: emojiName,
              type: data.expression,
              onNameChange: handleNameChange
            }),
            jsx(Components.GuildSelect, {
              data,
              value: selectedGuildId,
              onChange: setSelectedGuildId,
              onError: setError,
            }),
            jsx("div", { className: "separator" }),
            jsx("div", {
              style: { position: "relative" },
              children: [
                null != error && jsx(BdApi.Components.Text, {
                  role: "alert",
                  size: BdApi.Components.Text.Sizes.SIZE_14,
                  color: BdApi.Components.Text.Colors.ERROR,
                  children: error,
                  style: { padding: 4, position: "absolute", bottom: "100%" },
                }),
                jsx(internals.ManaButton, {
                  fullWidth: true,
                  loading: isPending,
                  disabled: isPending || null == data || null == selectedGuildId || emojiName.length < 2 || null != error,
                  text: "Clone",
                  type: "submit",
                  onClick: () => {
                    if (null == selectedGuildId || null == data) return;

                    startTransition(async () => {
                      await Utils.cloneExpression(selectedGuildId, data);
                    })
                  }
                })
              ]
            })
          )
        ]
      })
    },

    /** @param {{data: Expression, url: string}} props */
    ExpressionPreview({ data, url }) {
      return jsx("div", {
        className: Utils.clsx("preview", data.expression),
        children: jsx("img", {
          src: url,
          alt: `${data.expression} preview`
        })
      })
    },

    /** @param {{label: string, name: string, type: "Emoji" | "Sticker", onNameChange: (name: string) => void}} props */
    NameInput({ label, name, type, onNameChange }) {
      const inputRef = useRef(null);
      const caretPosition = useRef(null);
      const [isFocused, setIsFocused] = useState(false);

      const onChange = useCallback(value => {
        caretPosition.current = inputRef.current?.selectionStart;

        if (type === "Emoji") {
          value = value.replace(/\s/g, "_");
          value = value.length < 2 ? value : internals.emojiAPI.sanitizeEmojiName(value);
        }

        onNameChange(value);
      }, [onNameChange]);

      useEffect(() => {
        if (null != caretPosition.current) {
          inputRef.current?.setSelectionRange(caretPosition.current, caretPosition.current);
          caretPosition.current = null;
        }
      })

      const onBlur = useCallback(() => {
        setIsFocused(false);
      }, []);

      const onFocus = useCallback(() => {
        setIsFocused(true);
      }, []);

      return jsx(internals.TextInput, {
        inputRef,
        showCharacterCount: true,
        error: isFocused ? "" : undefined,
        minLength: 2,
        maxLength: type === "Emoji" ? 32 : 30,
        value: name,
        onChange,
        placeholder: `${type} name`,
        name: `${type}_name`,
        onBlur,
        onFocus,
        label,
        clearable: true,
        required: true,
      })
    },

    /** @param {{data: Expression, value: string, onChange: (guildId: string) => void, onError: (err: string) => void}} props */
    GuildSelect({ data, value, onChange, onError }) {
      const sortedGuilds = BdApi.Hooks.useStateFromStores(
        [Stores.GuildStore, Stores.SortedGuildStore],
        () => Stores.SortedGuildStore.getFlattenedGuildIds().map(gId => Stores.GuildStore.getGuild(gId)).filter(Boolean)
      );

      const guildCandidates = useMemo(() => sortedGuilds.filter(g =>
        Stores.PermissionStore.can(internals.PermissionsBits.CREATE_GUILD_EXPRESSIONS, g)
      ), [sortedGuilds, data.id]);

      const openSlots = BdApi.Hooks.useStateFromStores(
        [Stores.EmojiStore, Stores.StickersStore],
        () => data.expression === "Emoji" ? Object.fromEntries(guildCandidates.map(g => {
          const emojis = Stores.EmojiStore.getGuildEmoji(g.id);
          const count = emojis.filter(e => e.animated === data.isAnimated && !e.managed).length ?? 0;
          const emojiSlots = internals.getGuildMaxEmojiSlots(g);

          return [g.id, emojiSlots - count];
        })) : data.expression === "Sticker" ? Object.fromEntries(guildCandidates.map(g => {
          const stickers = Stores.StickersStore.getStickersByGuildId(g.id);
          const stickerSlots = internals.getGuildMaxStickerSlots(g.premiumTier, g);

          return [g.id, stickerSlots - stickers.length];
        })) : {},
        [guildCandidates, data.isAnimated, data.expression]
      );

      const options = useMemo(() => guildCandidates.map(e => ({
        label: e.name,
        value: e.id,
        disabled: openSlots[e.id] < 1 ? true : null
      })), [guildCandidates, openSlots]);

      const formatOption = useCallback(o => {
        const guild = guildCandidates.find(g => g.id === o.value);

        return {
          id: String(o.value),
          ...o,
          leading: null == o.value || null == guild ? null : jsx(internals.GuildIcon, {
            guild: guild,
            size: internals.GuildIcon.Sizes.SMALLER,
            active: true
          }),
          trailing: null == o.value ? null : `${openSlots[o.value]} slots`
        }
      }, [openSlots, guildCandidates]);

      useEffect(() => {
        if (guildCandidates.length < 1) {
          onError("No permissions in any server.");
        } else if (null != value && (openSlots?.[value] ?? 0) < 1) {
          onError(`This server ran out of ${data.expression.toLowerCase()} slots.`);
        } else {
          onError(null);
        }
      }, [guildCandidates, onChange, onError, value, openSlots]);

      return jsx(internals.FormSelect, {
        label: "Upload to",
        required: true,
        selectionMode: "single",
        onSelectionChange: onChange,
        options,
        formatOption,
        value,
        placeholder: guildCandidates.length < 1 ? 'N/A' : 'Select Server',
        disabled: guildCandidates.length < 1,
        shouldFocusWrap: true,
      })
    }
  }

  return { start, stop }
}
