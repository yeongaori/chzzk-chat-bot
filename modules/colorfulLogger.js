const colors = {
    noformat: '\033[0m',
    Fbold: '\033[1m',
    Fgreen: '\x1b[32m',
    Fblue: '\x1b[34m',
    Fred: '\x1b[31m',
    Fwhite: '\x1b[37m',
    Cwhite: '\033[38;5;15m',
    Clime: '\033[48;5;10m',
    Cred: '\033[48;5;9m',
    Cyellow: '\033[48;5;3m',
    Cgreen: '\033[48;5;2m',
    Ccyan: '\033[48;5;6m',
    Corange: '\033[48;5;202m'
};

module.exports = {
    info(message) {
        console.log(`${colors.Clime}${colors.Fwhite} INFO ${colors.noformat} ${message}`);
    },
    warn(message) {
        console.log(`${colors.Cyellow}${colors.Fwhite} WARN ${colors.noformat} ${message}`);
    },
    error(message) {
        console.error(`${colors.Cred}${colors.Fwhite} ERRO ${colors.noformat} ${message}`);
    },
    debug(message) {
        console.log(`${colors.Corange}${colors.Fwhite} DEBG ${colors.noformat} ${message}`);
    },
    term(message) {
        console.log(`${colors.Ccyan}${colors.Fwhite} TERM ${colors.noformat} ${message}`)

    }
};