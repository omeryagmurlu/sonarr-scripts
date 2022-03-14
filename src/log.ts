import chalk from 'chalk';

interface Options {
    level: number,
    date: boolean,
}

let __opts = {
    level: 10,
    date: true,
}

const __log = (preface: string, ...x: any) => {
    let string = preface + " ";
    if (__opts.date) {
        string += chalk.grey((new Date()).toISOString())
    }
    console.log(string, ...x);
}

export const options = (opts: Options) => {
    __opts = JSON.parse(JSON.stringify(opts))
} 

// level 2
export const error = (...x: any[]) => {
    if (__opts.level >= 2) __log(chalk.red('ERROR  '), ...x)
}

// level 3
export const warn = (...x: any[]) => {
    if (__opts.level >= 3) __log(chalk.yellow('WARNING'), ...x)
}

// level 5
export const log = (...x: any[]) => {
    if (__opts.level >= 5) __log('LOG    ', ...x)
}

// level 8
export const trace = (...x: any[]) => {
    if (__opts.level >= 8) __log(chalk.cyan('TRACE  '), ...x)
}
