package main

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// launched marks a run of this test binary that is to be the launcher: a
// test starts the binary it runs in once more, as a project starts the
// program, since the package cannot be built from where a consumer's go
// command keeps it.
const launched = "CURLY_LINT_TEST_LAUNCHED"

func TestMain(m *testing.M) {
	if os.Getenv(launched) != "" {
		os.Exit(launch(os.Args[1:], os.Stderr))
	}

	os.Exit(m.Run())
}

type result struct {
	status         int
	stdout, stderr string
}

// start prepares the launcher over a cache directory, in a directory of
// its own, with whatever else the environment is to hold.
func start(t *testing.T, cache string, env []string, args ...string) *exec.Cmd {
	t.Helper()

	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	command := exec.Command(self, args...)
	command.Dir = t.TempDir()
	command.Env = append(os.Environ(), launched+"=1", cacheVariable+"="+cache)
	command.Env = append(command.Env, env...)

	return command
}

// collect runs a prepared launcher to its end.
func collect(command *exec.Cmd) (result, error) {
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr

	err := command.Run()

	var exit *exec.ExitError
	if err != nil && !errors.As(err, &exit) {
		return result{}, err
	}

	return result{command.ProcessState.ExitCode(), stdout.String(), stderr.String()}, nil
}

func finish(t *testing.T, command *exec.Cmd) result {
	t.Helper()

	run, err := collect(command)
	if err != nil {
		t.Fatal(err)
	}

	return run
}

func launcher(t *testing.T, cache string, args ...string) result {
	t.Helper()

	return finish(t, start(t, cache, nil, args...))
}

// entries are the names a directory holds.
func entries(t *testing.T, directory string) []string {
	t.Helper()

	found, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}

	names := make([]string, len(found))
	for index, entry := range found {
		names[index] = entry.Name()
	}

	return names
}

func TestPlaceKeepsTheCommand(t *testing.T) {
	root := t.TempDir()

	path, err := place(root, native)
	if err != nil {
		t.Fatal(err)
	}
	if !holds(path, native) {
		t.Fatalf("%s does not hold the command", path)
	}
	if filepath.Base(path) != program || filepath.Dir(filepath.Dir(path)) != root {
		t.Fatalf("the command is kept at %s, not at %s/<sha256>/%s", path, root, program)
	}

	// Beside the command, nothing is left of how it was written.
	if names := entries(t, filepath.Dir(path)); len(names) != 1 {
		t.Fatalf("the command's directory holds %v", names)
	}
}

func TestPlaceLeavesAHeldCommandAlone(t *testing.T) {
	root := t.TempDir()

	path, err := place(root, native)
	if err != nil {
		t.Fatal(err)
	}

	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	again, err := place(root, native)
	if err != nil {
		t.Fatal(err)
	}

	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if again != path || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("a second run wrote the command again, at %s", again)
	}
}

func TestPlaceWritesAgainWhatDiffers(t *testing.T) {
	for name, held := range map[string][]byte{
		"cut short": native[:len(native)/2],
		"empty":     {},
		"another":   append([]byte("#!/bin/sh\nexit 7\n"), native...),
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()

			path, err := place(root, native)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, held, 0o755); err != nil {
				t.Fatal(err)
			}

			again, err := place(root, native)
			if err != nil {
				t.Fatal(err)
			}
			if again != path || !holds(path, native) {
				t.Fatalf("%s is left holding what is not the command", path)
			}
		})
	}
}

// A file that holds the command and cannot be run, as one restored without
// its mode, is written again where a mode is what lets a program run.
func TestPlaceWritesAgainWhatCannotRun(t *testing.T) {
	if runnable == 0 {
		t.Skip("no mode keeps a program from running here")
	}

	root := t.TempDir()

	path, err := place(root, native)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}

	again, err := place(root, native)
	if err != nil {
		t.Fatal(err)
	}

	kept, err := os.Stat(again)
	if err != nil {
		t.Fatal(err)
	}
	if again != path || kept.Mode().Perm()&runnable != runnable || !holds(path, native) {
		t.Fatalf("%s is left with the mode %v", path, kept.Mode().Perm())
	}
}

func TestPlaceFailsWhereNothingCanBeKept(t *testing.T) {
	// A file where the directory is to be: no permission is asked, so this
	// fails for every user and on every system.
	root := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(root, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	if path, err := place(root, native); err == nil {
		t.Fatalf("the command is said to be kept at %s", path)
	}
}

func TestRunAnswersWhatCannotStart(t *testing.T) {
	path := filepath.Join(t.TempDir(), program)
	if err := os.WriteFile(path, []byte("no program of any system"), 0o755); err != nil {
		t.Fatal(err)
	}

	if status, err := run(path, nil); err == nil {
		t.Fatalf("what is no program is said to have run, with status %d", status)
	}
}

func TestTheCommandRuns(t *testing.T) {
	cache := t.TempDir()

	help := launcher(t, cache, "--help")
	if help.status != 0 || !strings.HasPrefix(help.stdout, "Usage: curly-lint ") || help.stderr != "" {
		t.Fatalf("--help: %+v", help)
	}

	// The command's own status for arguments it cannot read, which is the
	// launcher's too where it cannot run the command: told apart by what
	// stderr holds.
	usage := launcher(t, cache)
	if usage.status != 2 || usage.stdout != "" || !strings.HasPrefix(usage.stderr, "Usage: curly-lint ") {
		t.Fatalf("no argument: %+v", usage)
	}
}

func TestFindingsAndTheirStatus(t *testing.T) {
	command := start(t, t.TempDir(), nil, "--locale", "en", "catalogue.json")
	if err := os.WriteFile(filepath.Join(command.Dir, "catalogue.json"), []byte(`{"greeting":"Hello, {{name"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	found := finish(t, command)
	if found.status != 1 || !strings.Contains(found.stdout, "catalogue.json:1:21") || !strings.Contains(found.stdout, "unclosed-placeholder") {
		t.Fatalf("a catalogue with an error: %+v", found)
	}
}

// What a shell would have to quote reaches the command as it was written:
// the command quotes the format it does not know as JSON does.
func TestArgumentsArriveAsWritten(t *testing.T) {
	for _, argument := range []string{
		`two words`,
		`a "quoted" word`,
		`ends in a backslash\`,
		`\\"both\\" `,
		`%PATH% $HOME ^ & | < >`,
		``,
	} {
		refused := launcher(t, t.TempDir(), "--format", argument, "catalogue.json")

		quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(argument)
		if refused.status != 2 || !strings.HasPrefix(refused.stderr, `Unknown format "`+quoted+`":`) {
			t.Fatalf("--format %q: %+v", argument, refused)
		}
	}
}

// Every first run over an empty cache at once: each writes the command or
// finds it written, and none fails for another's having got there first.
func TestFirstRunsAtOnce(t *testing.T) {
	cache := t.TempDir()
	results := make([]result, 16)
	failures := make([]error, len(results))

	var all sync.WaitGroup
	for index := range results {
		command := start(t, cache, nil, "--help")

		all.Add(1)
		go func() {
			defer all.Done()

			results[index], failures[index] = collect(command)
		}()
	}
	all.Wait()

	for index, run := range results {
		if failures[index] != nil {
			t.Fatal(failures[index])
		}
		if run.status != 0 || !strings.HasPrefix(run.stdout, "Usage: curly-lint ") || run.stderr != "" {
			t.Fatalf("one of the first runs: %+v", run)
		}
	}

	held := entries(t, cache)
	if len(held) != 1 {
		t.Fatalf("the cache holds %v, not one directory", held)
	}
	if names := entries(t, filepath.Join(cache, held[0])); len(names) != 1 || names[0] != program {
		t.Fatalf("the command's directory holds %v", names)
	}
}

// A cache named from the directory the launcher is started in.
func TestARelativeCache(t *testing.T) {
	command := start(t, "kept", nil, "--help")

	help := finish(t, command)
	if help.status != 0 || !strings.HasPrefix(help.stdout, "Usage: curly-lint ") || help.stderr != "" {
		t.Fatalf("--help: %+v", help)
	}
	if held := entries(t, filepath.Join(command.Dir, "kept")); len(held) != 1 {
		t.Fatalf("the cache holds %v, not one directory", held)
	}
}

func TestACacheThatCannotHoldTheCommand(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(cache, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	failed := launcher(t, cache, "--help")
	if failed.status != 2 || failed.stdout != "" || !strings.HasPrefix(failed.stderr, "curly-lint: the command could not be kept in "+cache+": ") || !strings.Contains(failed.stderr, cacheVariable) || strings.Count(failed.stderr, "\n") != 1 {
		t.Fatalf("a cache that is a file: %+v", failed)
	}
}

// The variables os.UserCacheDir reads on the systems the module holds a
// command for, each naming a directory of the test's own.
func userCache(directory string) []string {
	return []string{"XDG_CACHE_HOME=" + directory, "HOME=" + directory, "LocalAppData=" + directory}
}

func TestTheUsersCacheDirectory(t *testing.T) {
	home := t.TempDir()

	help := finish(t, start(t, "", userCache(home), "--help"))
	if help.status != 0 || !strings.HasPrefix(help.stdout, "Usage: curly-lint ") {
		t.Fatalf("--help: %+v", help)
	}

	// Wherever this system keeps a user's cache under what the variables
	// name, the command is in a directory of the program's name there.
	var kept []string
	err := filepath.WalkDir(home, func(path string, entry os.DirEntry, err error) error {
		if err == nil && !entry.IsDir() {
			kept = append(kept, path)
		}

		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 1 || filepath.Base(kept[0]) != program || filepath.Base(filepath.Dir(filepath.Dir(kept[0]))) != "curly-lint" || !holds(kept[0], native) {
		t.Fatalf("the user's cache holds %v", kept)
	}
}

func TestNoCacheDirectory(t *testing.T) {
	failed := finish(t, start(t, "", userCache(""), "--help"))
	if failed.status != 2 || failed.stdout != "" || !strings.HasPrefix(failed.stderr, "curly-lint: there is no directory to keep the command in: ") || !strings.Contains(failed.stderr, cacheVariable) || strings.Count(failed.stderr, "\n") != 1 {
		t.Fatalf("no cache directory: %+v", failed)
	}
}
