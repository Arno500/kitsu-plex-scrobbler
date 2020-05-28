module.exports = {
    development: {
        //  client: 'pg',
        //  connection: process.env.DATABASE_URL || { user: 'postgres', database: 'kitsu-plex-scrobbler' },
        client: "sqlite3",
        connection: {
            filename: "db.sqlite",
        },
        useNullAsDefault: true,
    },
    production: {
        //  client: 'pg',
        //  connection: process.env.DATABASE_URL,
        client: "sqlite3",
        connection: {
            filename: "./db.sqlite",
        },
        useNullAsDefault: true,
    },
};
