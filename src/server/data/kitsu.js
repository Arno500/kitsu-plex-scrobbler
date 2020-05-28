const Kitsu = require("kitsu");
// const OAuth2 = require("client-oauth2");

const User = require("../models/User");

const kitsu = new Kitsu({
    headers: { "User-Agent": "kitsu-plex-scrobbler/1.0.1" },
});

// const auth = new OAuth2({ accessTokenUri: "https://kitsu.io/api/oauth/token" });
const oauth2 = require("simple-oauth2").create({
    client: {
        id: "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd",
        secret:
            "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151",
    },
    auth: {
        tokenHost: "https://kitsu.io",
        tokenPath: "/api/oauth/token",
    },
});

const login = async (username, password) => {
    try {
        const result = await oauth2.ownerPassword.getToken({
            username,
            password,
        });
        return oauth2.accessToken.create(result).token;
    } catch (err) {
        throw new Error(err);
    }
    // return await auth.owner.getToken(username, password);
};

const refresh = async (user) => {
    if (user.kitsuExpires > new Date(Date.now())) {
        return user;
    }

    // let token = auth.createToken(user.kitsuToken, user.kitsuRefresh, "bearer");
    let token = oauth2.accessToken.create({
        access_token: user.kitsuToken,
        refresh_token: user.kitsuRefresh,
        expires_at: user.kitsuExpires,
    });
    let refresh = await token.refresh();
    let {
        accessToken: kitsuToken,
        refreshToken: kitsuRefresh,
        expires,
    } = refresh;

    let { username } = user;
    let [refreshed] = await User.query()
        .patch({
            kitsuToken,
            kitsuRefresh,
            kitsuExpires: new Date(Date.now() + expires),
        })
        .where({ username })
        .returning("*");
    return refreshed;
};

const getUser = async (user) => {
    user = await refresh(user);
    return await kitsu.self(
        {
            fields: { users: "id,avatar,name" },
        },
        {
            Authorization: "Bearer " + user.kitsuToken,
        }
    );
};

const scrobble = async (user, kitsuUser, metadata) => {
    user = await refresh(user);

    let { kitsu: kitsuId, anidb, tvdb, media, season, episode } = metadata;
    let { id: userId } = kitsuUser;

    console.log("scrobbling:", media, episode ? `${season} ${episode}` : "");

    let anime;
    if (kitsuId) {
        anime = await getAnime(kitsuId);
    } else {
        let mapping;

        if (anidb) {
            mapping = await findMapping("anidb", anidb);
        }

        if (tvdb && !mapping) {
            let tvdbSeason = `${tvdb}/${season}`;
            mapping = await findMapping("thetvdb", tvdbSeason);
            if (!mapping) {
                mapping = await findMapping("thetvdb", tvdb);
            }
            if (!mapping) {
                mapping = await findMapping("thetvdb/series", tvdbSeason);
            }
            if (!mapping) {
                mapping = await findMapping("thetvdb/series", tvdb);
            }
        }

        if (mapping) {
            anime = mapping.item;
        } else {
            console.log("no mapping found");
        }
    }

    if (!anime) {
        return;
    }

    episode = episode || 1;

    let entry = await findEntry(anime.id, userId);
    if (entry) {
        if (entry.progress >= episode) {
            console.log("progress is farther than episode, ignoring");
            return;
        }
        try {
            await kitsu.patch(
                "libraryEntries",
                {
                    id: entry.id,
                    progress: episode,
                },
                {
                    Authorization: "Bearer " + user.kitsuToken,
                }
            );
            console.log("updated library entry to", episode);
        } catch (e) {
            console.log("error updating library entry:", e);
        }
    } else {
        try {
            await kitsu.post(
                "libraryEntries",
                {
                    progress: episode,
                    status:
                        episode == anime.episodeCount ? "completed" : "current",
                    anime: { type: "anime", id: anime.id },
                    user: { type: "users", id: userId },
                },
                {
                    Authorization: "Bearer " + user.kitsuToken,
                }
            );
            console.log("created library entry at progress", episode);
        } catch (e) {
            console.log("error creating library entry:", e);
        }
    }
};

const getAnime = async (id) => {
    try {
        let { data: anime } = await kitsu.get("anime/" + id);
        console.log("found anime:", anime.canonicalTitle);
        return anime;
    } catch (e) {
        console.log("error getting anime for id", id, e);
    }
};

const findMapping = async (externalSite, externalId) => {
    try {
        let response = await kitsu.get("mappings", {
            filter: { externalSite, externalId },
            include: "item",
            fields: {
                mappings: "item",
                anime: "id,episodeCount",
            },
        });
        let mapping = response.data[0];
        if (mapping) {
            console.log("found mapping:", externalSite, mapping.id);
            return mapping;
        }
    } catch (e) {
        console.log("error looking up by", externalSite, e);
    }
};

const findEntry = async (animeId, userId) => {
    try {
        let response = await kitsu.get("libraryEntries", {
            filter: { userId, animeId },
            fields: { libraryEntries: "id,progress" },
        });
        let entry = response.data[0];
        if (entry) {
            console.log("found entry:", entry.id);
            return entry;
        }
    } catch (e) {
        console.log("error getting library entry:", e);
    }
};

module.exports = { login, getUser, scrobble };
