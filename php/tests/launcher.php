<?php

declare(strict_types=1);

// The launcher's tests, over the package as Composer installed it:
// `php tests/launcher.php <project>`, where <project> is a project that
// requires the package, so `vendor/bin/` holds what a project starts and
// `vendor/curly-message/lint/` the launcher beside its commands. A test that
// needs a command of its own, or a package that lacks one, makes a copy of
// the installed package and starts the copy's launcher: the launcher runs
// the command beside it and can be pointed nowhere else.

$project = realpath($argv[1] ?? '');

if ($argc !== 2 || $project === false || !is_file("{$project}/vendor/curly-message/lint/bin/curly-lint")) {
    fwrite(STDERR, "usage: php tests/launcher.php <a project that installed curly-message/lint>\n");

    exit(2);
}

const PACKAGE = 'vendor/curly-message/lint';
const WINDOWS = PHP_OS_FAMILY === 'Windows';

/** The file the launcher runs on this machine, as it names it. */
function name(): string
{
    return 'curly-lint-' . PHP_OS_FAMILY . '-' . php_uname('m') . (WINDOWS ? '.exe' : '');
}

/** A directory of its own, removed when the tests end. */
function scratch(): string
{
    $directory = sys_get_temp_dir() . '/curly-lint-test-' . bin2hex(random_bytes(8));

    if (!mkdir($directory, 0700)) {
        throw new RuntimeException("{$directory} could not be made.");
    }

    register_shutdown_function(remove(...), $directory);

    return (string) realpath($directory);
}

function remove(string $path): void
{
    if (is_dir($path) && !is_link($path)) {
        foreach (array_diff((array) scandir($path), ['.', '..']) as $entry) {
            remove("{$path}/{$entry}");
        }

        rmdir($path);
    } else {
        unlink($path);
    }
}

/** A copy of a tree, each file with the mode it has. */
function duplicate(string $from, string $to): void
{
    if (is_dir($from)) {
        mkdir($to);

        foreach (array_diff((array) scandir($from), ['.', '..']) as $entry) {
            duplicate("{$from}/{$entry}", "{$to}/{$entry}");
        }
    } else {
        copy($from, $to);
        chmod($to, (int) fileperms($from) & 0777);
    }
}

/**
 * A program run to its end, on no standard input.
 *
 * @param list<string> $command
 *
 * @return array{status: int, stdout: string, stderr: string}
 */
function run(array $command, ?string $directory = null): array
{
    $kept = scratch();
    $process = proc_open($command, [['file', WINDOWS ? 'NUL' : '/dev/null', 'r'], ['file', "{$kept}/stdout", 'w'], ['file', "{$kept}/stderr", 'w']], $pipes, $directory);

    if ($process === false) {
        throw new RuntimeException("{$command[0]} could not be started.");
    }

    return ['status' => proc_close($process), 'stdout' => (string) file_get_contents("{$kept}/stdout"), 'stderr' => (string) file_get_contents("{$kept}/stderr")];
}

/**
 * The launcher of a package, started by this PHP, with whatever it is
 * configured by.
 *
 * @param list<string> $arguments
 * @param list<string> $configuration
 *
 * @return array{status: int, stdout: string, stderr: string}
 */
function launch(string $package, array $arguments, array $configuration = [], ?string $directory = null): array
{
    return run([PHP_BINARY, ...$configuration, "{$package}/bin/curly-lint", ...$arguments], $directory);
}

/**
 * A copy of the installed package whose command for this machine is the
 * bytes given, the package's own where they are empty, or no file at all.
 */
function package(string $project, ?string $command = null, int $mode = 0755): string
{
    $copy = scratch() . '/lint';

    duplicate("{$project}/" . PACKAGE, $copy);

    if ($command === null) {
        unlink("{$copy}/commands/" . name());
    } elseif ($command !== '') {
        file_put_contents("{$copy}/commands/" . name(), $command);
    }

    if ($command !== null && !WINDOWS) {
        chmod("{$copy}/commands/" . name(), $mode);
    }

    return $copy;
}

function mode(string $path): int
{
    clearstatcache();

    return (int) fileperms($path) & 0777;
}

/** @var array<string, callable(): (string|null)> $tests each answers null, or why it was skipped */
$tests = [];

/** @param array{status: int, stdout: string, stderr: string} $run */
$expect = static function (bool $held, string $what, array $run): void {
    if (!$held) {
        throw new RuntimeException("{$what}: " . json_encode($run, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE));
    }
};

// What a project starts: the file Composer writes into `vendor/bin/`. On
// Windows that file is started by PHP, as the `.bat` beside it starts it.
$proxy = WINDOWS ? [PHP_BINARY, "{$project}/vendor/bin/curly-lint"] : ["{$project}/vendor/bin/curly-lint"];

$tests['the command runs'] = static function () use ($proxy, $expect): ?string {
    $help = run([...$proxy, '--help']);

    // PHP warns on standard error where it cannot attach the launcher's
    // console handler.
    $expect($help['status'] === 0 && str_starts_with($help['stdout'], 'Usage: curly-lint ') && $help['stderr'] === '', '--help', $help);

    $usage = run($proxy);

    $expect($usage['status'] === 2 && $usage['stdout'] === '' && str_contains($usage['stderr'], 'Usage: curly-lint '), 'no argument', $usage);

    return null;
};

$tests['findings and their status'] = static function () use ($proxy, $expect): ?string {
    $directory = scratch();

    file_put_contents("{$directory}/catalogue.json", '{"greeting":"Hello, {{name"}');

    $found = run([...$proxy, '--locale', 'en', 'catalogue.json'], $directory);

    $expect($found['status'] === 1 && str_contains($found['stdout'], 'unclosed-placeholder') && $found['stderr'] === '', 'a catalogue with an error', $found);

    return null;
};

// What a shell would have to quote reaches the command as it was written:
// the command quotes the format it does not know as JSON does. Through
// `php vendor/bin/curly-lint`, the one form no shell reads on any system.
$tests['arguments arrive as written'] = static function () use ($project, $expect): ?string {
    foreach (['two words', 'a "quoted" word', 'ends in a backslash\\', '\\\\"both\\\\" ', '%PATH% $HOME ^ & | < >', '{locale}/{{name}}', '', "caf\u{e9} \u{4e2d}"] as $argument) {
        $refused = run([PHP_BINARY, "{$project}/vendor/bin/curly-lint", '--format', $argument, 'catalogue.json']);
        $quoted = strtr($argument, ['\\' => '\\\\', '"' => '\\"']);

        $expect($refused['status'] === 2 && str_starts_with($refused['stderr'], "Unknown format \"{$quoted}\":"), "--format {$argument}", $refused);
    }

    // A PHP told to fill no $_SERVER still holds what it was run with.
    $help = run([PHP_BINARY, '-d', 'variables_order=GPC', "{$project}/vendor/bin/curly-lint", '--help']);

    $expect($help['status'] === 0 && str_starts_with($help['stdout'], 'Usage: curly-lint ') && $help['stderr'] === '', '--help with no $_SERVER', $help);

    return null;
};

$tests['a platform the package holds no command for'] = static function () use ($project, $expect): ?string {
    $copy = package($project);
    $refused = launch($copy, ['--help']);
    $start = 'curly-lint: this package holds no command for ' . PHP_OS_FAMILY . ' on ' . php_uname('m') . ': ';
    $end = '/commands/' . name() . " is no file. It holds one for Linux and macOS on x86-64 and ARM64 and for Windows on x86-64.\n";

    $expect($refused['status'] === 2 && $refused['stdout'] === '' && str_starts_with($refused['stderr'], $start) && str_ends_with($refused['stderr'], $end), 'no command file', $refused);

    return null;
};

$tests['a command that lost its mode is repaired'] = static function () use ($project, $expect): ?string {
    if (WINDOWS) {
        return 'Windows runs a file by its name';
    }

    $copy = package($project, '', 0644);
    $help = launch($copy, ['--help']);

    $expect($help['status'] === 0 && str_starts_with($help['stdout'], 'Usage: curly-lint ') && $help['stderr'] === '' && mode("{$copy}/commands/" . name()) === 0755, '--help over a command of mode 644, left ' . decoct(mode("{$copy}/commands/" . name())), $help);

    return null;
};

$tests['a command chmod cannot repair'] = static function () use ($project, $expect): ?string {
    if (WINDOWS || trim((string) shell_exec('id -u')) === '0') {
        return 'chmod does not fail here';
    }

    $copy = package($project, '', 0644);
    $command = "{$copy}/commands/" . name();

    if (run(['sudo', '-n', 'chown', '0', $command])['status'] !== 0) {
        return 'no sudo to give the command another owner';
    }

    $refused = launch($copy, ['--help']);

    $expect($refused['status'] === 2 && $refused['stdout'] === '' && $refused['stderr'] === "curly-lint: {$command} is not a program this user can run (its mode, its owner, or a noexec mount), and chmod could not change that.\n" && mode($command) === 0644, 'a command of another owner', $refused);

    return null;
};

$tests['a PHP with a function the launcher needs disabled'] = static function () use ($project, $expect): ?string {
    foreach (['php_uname', 'proc_open', 'proc_close'] as $disabled) {
        $refused = launch("{$project}/" . PACKAGE, ['--help'], ['-d', "disable_functions={$disabled}"]);

        $expect($refused['status'] === 2 && $refused['stdout'] === '' && $refused['stderr'] === "curly-lint: cannot run: this PHP has {$disabled} disabled.\n", "{$disabled} disabled", $refused);
    }

    if (WINDOWS) {
        return null;
    }

    $copy = package($project, '', 0644);
    $command = "{$copy}/commands/" . name();
    $refused = launch($copy, ['--help'], ['-d', 'disable_functions=chmod']);

    $expect($refused['status'] === 2 && $refused['stdout'] === '' && $refused['stderr'] === "curly-lint: {$command} is not a program this user can run (its mode, its owner, or a noexec mount), and chmod could not change that.\n" && mode($command) === 0644, 'chmod disabled', $refused);

    return null;
};

// What happens to a file that looks like a program and is none is the PHP
// build's way of starting a process: the launcher's line where PHP is told
// the file did not start, the status of the child PHP forked where it is
// not. Never a run that reads as the command's.
$tests['a command that cannot start'] = static function () use ($project, $expect): ?string {
    if (WINDOWS) {
        return 'Windows runs a file by its name';
    }

    $copy = package($project, "\x7fELF\x02\x01\x01");
    $failed = launch($copy, ['--help']);

    $expect($failed['stdout'] === '' && ($failed['status'] === 127 || ($failed['status'] === 2 && str_contains($failed['stderr'], "curly-lint: {$copy}/commands/" . name() . " could not be run.\n"))), 'a file that is no program', $failed);

    return null;
};

// The statuses the command itself exits with, 0, 1 and 2, are held above on
// every system. A status of another program's choosing takes a script, which
// Windows runs through no file of this name.
$tests["the command's status is the launcher's"] = static function () use ($project, $expect): ?string {
    if (WINDOWS) {
        return 'Windows runs a file by its name';
    }

    $copy = package($project, "#!/bin/sh\nexit 7\n");
    $seven = launch($copy, []);

    $expect($seven['status'] === 7 && $seven['stderr'] === '', 'a command that exits 7', $seven);

    // A command a signal ended exits the launcher with the signal's number.
    $copy = package($project, "#!/bin/sh\nkill -TERM \$\$\n");
    $killed = launch($copy, []);

    $expect($killed['status'] === 15, 'a command ended by SIGTERM', $killed);

    return null;
};

// The launcher holds no list of platforms: it builds a file's name from what
// PHP reports. The README states each name beside the two words it is built
// from, and the package holds those files and no other.
$tests['the commands are the ones the README names'] = static function () use ($project): ?string {
    preg_match_all('/^\|[^|]*\| `(\w+)` \| `(\w+)` \| `commands\/([^`]+)` \|$/m', (string) file_get_contents("{$project}/" . PACKAGE . '/README.md'), $rows, PREG_SET_ORDER);

    $named = [];

    foreach ($rows as [, $family, $machine, $file]) {
        if ($file !== "curly-lint-{$family}-{$machine}" . ($family === 'Windows' ? '.exe' : '')) {
            throw new RuntimeException("The README names {$file} for {$family} on {$machine}, which the launcher does not build.");
        }

        $named[] = $file;
    }

    $held = array_values(array_diff((array) scandir("{$project}/" . PACKAGE . '/commands'), ['.', '..']));

    sort($named);
    sort($held);

    // A package packed on one machine for itself holds that machine's
    // command alone; a release holds every one.
    if ($named === [] || array_diff($held, $named) !== [] || ($held !== [name()] && $held !== $named)) {
        throw new RuntimeException('The package holds ' . implode(', ', $held) . ', and its README names ' . implode(', ', $named) . '.');
    }

    return null;
};

$failed = 0;

foreach ($tests as $title => $test) {
    try {
        $skipped = $test();

        echo $skipped === null ? "ok       {$title}\n" : "skipped  {$title}: {$skipped}\n";
    } catch (Throwable $thrown) {
        $failed += 1;

        echo "FAILED   {$title}\n         {$thrown->getMessage()}\n";
    }
}

exit($failed === 0 ? 0 : 1);
