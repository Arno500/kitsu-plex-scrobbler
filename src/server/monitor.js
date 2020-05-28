const { Tail } = require("tail");
const path = require("path");
const untildify = require("untildify");

const { PLEX_LOGS } = require("./config");
const { buildUser } = require("./util");
const plex = require("./data/plex");
const kitsu = require("./data/kitsu");
const User = require("./models/User");

try {
    const tail = new Tail(
        untildify(path.join(PLEX_LOGS, "Plex Media Server.log"))
    );
    let playData = {};
    tail.on("line", async (line) => {
        try {
            // let matches = line.match(/Library item (\d+) \'(.*?)\' got played by account (\d+)!.*?/)
            const resetPlayData = (id) => {
                if (playData.id === id) playData = {};
            };
            let playDataMatches = line.match(
                /Client .*? reporting timeline state (.*), progress of ([0-9]*)\/([0-9]*)ms .* metadataId=([0-9]*)/
            );
            if (playDataMatches) {
                let [match, status, time, duration, id] = playDataMatches;
                playData = {
                    id,
                    time,
                    duration,
                    progress: time / duration,
                    status,
                };
                return;
            }

            let userMatch = line.match(/User is (.*) \(ID: ([0-9]*)\)/);
            let conclusionMatch = line.match(
                /Play progress on ([0-9]*) .* got played ([0-9]*) ms by account ([0-9]*)!/
            );
            if ((userMatch || conclusionMatch) && playData.id) {
                let username;
                let id;
                const workingPlayData = playData;
                if (userMatch) {
                    username = userMatch[1];
                    id = userMatch[2];
                } else if (conclusionMatch) {
                    id = conclusionMatch[3];
                }
                // let [match, username, id] = userMatch;
                console.debug(
                    `${username ? username + " " : ""}(${id}) is watching ${
                        workingPlayData.id
                    } and is currently at ${workingPlayData.progress * 100}%`
                );
                if (
                    workingPlayData.progress <= 0.9 ||
                    workingPlayData.status !== "stopped"
                ) {
                    resetPlayData(workingPlayData.id);
                    return;
                }

                let user = await User.query().findById(id);
                if (!user || !user.kitsuUser) {
                    resetPlayData(workingPlayData.id);
                    return console.log("user has not logged in");
                }

                user = await buildUser(user);
                let sections = user.sections
                    .filter((s) => s.scrobble)
                    .map((s) => s.uuid);

                let metadata = await plex.getMetadata(
                    sections,
                    workingPlayData.id,
                    user.authToken
                );
                if (metadata) {
                    let kitsuUser = await kitsu.getUser(user);
                    kitsu.scrobble(user, kitsuUser, metadata);
                }
                resetPlayData(workingPlayData.id);
            }
        } catch (e) {
            resetPlayData();
            console.error(e);
        }
    });

    console.log("monitoring pmslog at", PLEX_LOGS);
} catch (e) {
    console.error("failed to monitor pmslog. check $PLEX_LOGS value");
    process.exit(1);
}
