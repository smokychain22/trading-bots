"""Parse and exercise the complete workflow without packages, secrets, or APIs."""
from __future__ import annotations

import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

BUNDLE = Path(__file__).resolve().parents[1]
REPOSITORY = Path(__file__).resolve().parents[3]
WORKFLOW = REPOSITORY / '.github/workflows/dot-basic-readonly.yml'
CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
REPO = 'smokychain22/trading-bots'
REF = 'refs/heads/codex/dot-basic-readonly-v1'
SECRET_NAMES = (
    'THETA_ALPACA_PAPER_KEY_ID',
    'THETA_ALPACA_PAPER_SECRET_KEY',
    'THETA_ALPACA_PAPER_ACCOUNT_NUMBER',
)
MODULES = {'theta_basic_lab/' + name for name in (
    '__init__.py', 'observations.py', 'providers.py', 'verify_readonly.py')}


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_workflow_key')
        result[key] = value
    return result


def load_workflow():
    # JSON is valid YAML. This deliberately disallows YAML tags, aliases, and
    # duplicate keys while requiring no dependency installation on the runner.
    return json.loads(WORKFLOW.read_text(), object_pairs_hook=unique_pairs)


def inline_python(step, marker):
    return step['run'].split("<<'" + marker + "'\n", 1)[1].rsplit('\n' + marker, 1)[0]


def stage_hashes(workflow):
    step = workflow['jobs']['verify_readonly']['steps'][2]
    tree = ast.parse(inline_python(step, 'PYSTAGE'))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'EXPECTED' for target in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError('missing_inline_hash_allowlist')


def all_dicts(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from all_dicts(item)
    elif isinstance(value, list):
        for item in value:
            yield from all_dicts(item)


class WorkflowStructureTests(unittest.TestCase):
    def setUp(self):
        self.workflow = load_workflow()
        self.jobs = self.workflow['jobs']

    def test_manual_only_and_single_required_reviewed_sha(self):
        self.assertEqual(set(self.workflow), {'name', 'on', 'permissions', 'concurrency', 'jobs'})
        self.assertEqual(set(self.workflow['on']), {'workflow_dispatch'})
        inputs = self.workflow['on']['workflow_dispatch']['inputs']
        self.assertEqual(set(inputs), {'reviewed_sha'})
        self.assertIs(inputs['reviewed_sha']['required'], True)
        self.assertEqual(inputs['reviewed_sha']['type'], 'string')
        self.assertNotIn('default', inputs['reviewed_sha'])

    def test_exact_jobs_and_read_only_token(self):
        self.assertEqual(set(self.jobs), {'source_tests', 'verify_readonly'})
        self.assertEqual(self.workflow['permissions'], {'contents': 'read'})
        for job in self.jobs.values():
            self.assertEqual(job['permissions'], {'contents': 'read'})
            self.assertEqual(job['runs-on'], 'ubuntu-24.04')
            self.assertNotIn('env', job)
            self.assertNotIn('container', job)
            self.assertNotIn('services', job)
            self.assertNotIn('strategy', job)
            self.assertNotIn('uses', job)
            self.assertNotIn('continue-on-error', job)
            self.assertLessEqual(job['timeout-minutes'], 3)
        self.assertLessEqual(sum(job['timeout-minutes'] for job in self.jobs.values()), 3)

    def test_secretless_tests_precede_protected_job(self):
        source, protected = self.jobs['source_tests'], self.jobs['verify_readonly']
        self.assertNotIn('environment', source)
        self.assertEqual(protected['needs'], ['source_tests'])
        self.assertEqual(protected['environment'], {'name': 'dot-basic-readonly'})
        self.assertEqual(len(source['steps']), 3)
        self.assertEqual(len(protected['steps']), 4)
        command = source['steps'][2]['run']
        self.assertEqual(command, 'set -euo pipefail\ncd -- tools/dot-basic-readonly\nenv -i PATH=/usr/bin:/bin /usr/bin/python3 -E -s -S -B -m unittest discover -s tests -v')
        self.assertNotIn('secrets.', json.dumps(source))

    def test_exact_repository_ref_sha_and_first_attempt_conditions(self):
        expected = "${{ github.event_name == 'workflow_dispatch' && github.repository == 'smokychain22/trading-bots' && github.ref == 'refs/heads/codex/dot-basic-readonly-v1' && github.sha == inputs.reviewed_sha && github.run_attempt == 1 }}"
        for job in self.jobs.values():
            self.assertEqual(job['if'], expected)
            self.assertEqual(job['steps'][0]['env'], {'REVIEWED_SHA': '${{ inputs.reviewed_sha }}'})
            self.assertIn('/usr/bin/python3 -I -S -B', job['steps'][0]['run'])
        self.assertEqual(self.jobs['source_tests']['steps'][0], self.jobs['verify_readonly']['steps'][0])

    def test_only_official_commit_pinned_checkout_action(self):
        actions = [step for job in self.jobs.values() for step in job['steps'] if 'uses' in step]
        self.assertEqual(len(actions), 2)
        for action in actions:
            self.assertEqual(action['uses'], CHECKOUT)
            self.assertRegex(action['uses'], r'^actions/checkout@[0-9a-f]{40}$')
            self.assertEqual(action['with'], {
                'repository': REPO, 'ref': '${{ github.sha }}',
                'persist-credentials': False, 'fetch-depth': 1,
                'submodules': False, 'lfs': False, 'show-progress': False,
                'sparse-checkout': '.github/workflows/dot-basic-readonly.yml\ntools/dot-basic-readonly',
                'sparse-checkout-cone-mode': False,
            })

    def test_exact_three_secret_references_only_on_final_step(self):
        steps = self.jobs['verify_readonly']['steps']
        env = steps[-1]['env']
        self.assertEqual(set(env), set(SECRET_NAMES) | {'THETA_GITHUB_ENVIRONMENT', 'THETA_VERIFIER_ROOT'})
        for name in SECRET_NAMES:
            self.assertEqual(env[name], '${{ secrets.' + name + ' }}')
        self.assertEqual(env['THETA_GITHUB_ENVIRONMENT'], 'dot-basic-readonly')
        self.assertEqual(env['THETA_VERIFIER_ROOT'], '${{ steps.stage.outputs.root }}')
        references = re.findall(r'secrets\.([A-Z0-9_]+)', json.dumps(self.workflow))
        self.assertCountEqual(references, SECRET_NAMES)
        without_final = copy.deepcopy(self.workflow)
        without_final['jobs']['verify_readonly']['steps'].pop()
        self.assertNotIn('secrets.', json.dumps(without_final))

    def test_only_bounded_isolated_verifier_runs_with_credentials(self):
        final = self.jobs['verify_readonly']['steps'][-1]
        self.assertEqual(set(final), {'name', 'shell', 'timeout-minutes', 'env', 'run'})
        self.assertEqual(final['timeout-minutes'], 1)
        self.assertEqual(final['run'], 'set -euo pipefail\ncd -- "$THETA_VERIFIER_ROOT"\nexec /usr/bin/python3 -E -s -S -B -m theta_basic_lab.verify_readonly --enable-api-read --require-github-environment dot-basic-readonly')
        self.assertEqual(final['shell'], 'bash')

    def test_no_install_cache_artifact_service_or_production_reference(self):
        text = json.dumps(self.workflow).lower()
        for forbidden in ('production', 'self-hosted', 'pip install', 'npm ', 'npx ', 'apt ', 'setup-python', 'upload-artifact', 'download-artifact', 'actions/cache', 'secrets: inherit', 'curl ', 'wget ', 'set -x'):
            self.assertNotIn(forbidden, text)
        for mapping in all_dicts(self.workflow):
            for forbidden in ('services', 'container', 'packages', 'id-token', 'secrets', 'continue-on-error'):
                self.assertNotIn(forbidden, mapping)

    def test_hash_allowlist_matches_exact_source_subset_and_manifest(self):
        expected = stage_hashes(self.workflow)
        self.assertEqual(set(expected), MODULES)
        for relative, digest in expected.items():
            self.assertRegex(digest, r'^[0-9a-f]{64}$')
            self.assertEqual(hashlib.sha256((BUNDLE / relative).read_bytes()).hexdigest(), digest)
        manifest = ''.join(f'{digest}  {relative}\n' for relative, digest in expected.items())
        self.assertEqual((BUNDLE / 'SOURCE_SHA256SUMS').read_text(), manifest)
        self.assertEqual({path.name for path in (BUNDLE / 'theta_basic_lab').iterdir() if path.name != '__pycache__'}, {Path(name).name for name in MODULES})

    def test_no_dynamic_expression_interpolation_inside_run_scripts(self):
        for job in self.jobs.values():
            for step in job['steps']:
                self.assertNotIn('${{', step.get('run', ''))
                if 'run' in step:
                    self.assertEqual(step['shell'], 'bash')

    def test_concurrency_does_not_cancel_an_active_check(self):
        self.assertEqual(self.workflow['concurrency'], {'group': 'dot-basic-readonly-v1', 'cancel-in-progress': False})


class DispatchGuardTests(unittest.TestCase):
    def setUp(self):
        self.code = inline_python(load_workflow()['jobs']['source_tests']['steps'][0], 'PYGUARD')
        self.env = {
            'PATH': '/usr/bin:/bin', 'GITHUB_ACTIONS': 'true',
            'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': REPO,
            'GITHUB_REF': REF, 'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_SHA': 'a' * 40, 'REVIEWED_SHA': 'a' * 40,
        }

    def run_guard(self, updates):
        env = dict(self.env, **updates)
        return subprocess.run(['/usr/bin/python3', '-I', '-S', '-B', '-c', self.code],
                              env=env, capture_output=True, text=True, timeout=5)

    def test_exact_valid_context(self):
        result = self.run_guard({})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'READONLY_DISPATCH_GUARD_PASSED\n')
        self.assertEqual(result.stderr, '')

    def test_reject_context_mismatch_and_reruns(self):
        for key, value in (
            ('GITHUB_ACTIONS', 'false'), ('GITHUB_EVENT_NAME', 'push'),
            ('GITHUB_EVENT_NAME', 'pull_request_target'), ('GITHUB_EVENT_NAME', 'schedule'),
            ('GITHUB_REPOSITORY', 'outsider/trading-bots'), ('GITHUB_REPOSITORY', REPO.upper()),
            ('GITHUB_REF', 'refs/heads/main'), ('GITHUB_REF', REF.upper()),
            ('GITHUB_RUN_ATTEMPT', '2'), ('GITHUB_SHA', 'b' * 40),
        ):
            with self.subTest(key=key, value=value):
                result = self.run_guard({key: value})
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, 'READONLY_DISPATCH_GUARD_REFUSED\n')
                self.assertEqual(result.stderr, '')

    def test_reject_invalid_sha_without_echoing_input(self):
        for value in ('', 'a' * 39, 'a' * 41, 'A' * 40, 'g' * 40, 'a' * 40 + '\n', '$(echo unsafe)', '"; echo unsafe; #'):
            with self.subTest(value=value):
                result = self.run_guard({'REVIEWED_SHA': value, 'GITHUB_SHA': value})
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, 'READONLY_DISPATCH_GUARD_REFUSED\n')
                self.assertEqual(result.stderr, '')


class ImmutableStagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'repository'
        self.source = self.workspace / 'tools/dot-basic-readonly'
        shutil.copytree(BUNDLE / 'theta_basic_lab', self.source / 'theta_basic_lab', ignore=shutil.ignore_patterns('__pycache__'))
        self.runner = self.root / 'runner'
        self.runner.mkdir()
        self.output = self.root / 'output'
        self.env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.root), 'GITHUB_WORKSPACE': str(self.workspace), 'RUNNER_TEMP': str(self.runner), 'GITHUB_OUTPUT': str(self.output)}
        for arguments in (['init', '--quiet'], ['add', '.'], ['-c', 'user.name=synthetic-test', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic fixture']):
            subprocess.run(['/usr/bin/git', *arguments], cwd=self.workspace, env=self.env, check=True, capture_output=True, timeout=5)
        self.sha = subprocess.run(['/usr/bin/git', 'rev-parse', 'HEAD'], cwd=self.workspace, env=self.env, check=True, capture_output=True, text=True, timeout=5).stdout.strip()
        self.env.update({'GITHUB_SHA': self.sha, 'REVIEWED_SHA': self.sha})
        self.code = inline_python(load_workflow()['jobs']['verify_readonly']['steps'][2], 'PYSTAGE')

    def tearDown(self):
        for directory, subdirs, files in os.walk(self.root):
            os.chmod(directory, 0o700)
        self.temp.cleanup()

    def run_stage(self):
        return subprocess.run(['/usr/bin/python3', '-I', '-S', '-B', '-c', self.code], env=self.env, capture_output=True, text=True, timeout=10)

    def assert_refused(self):
        result = self.run_stage()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, 'READONLY_REVIEWED_SUBSET_REFUSED\n')
        self.assertEqual(result.stderr, '')
        self.assertFalse(self.output.exists())

    def test_stages_only_reviewed_four_modules_not_repository_hooks(self):
        (self.source / 'sitecustomize.py').write_text('raise RuntimeError("must not execute")')
        (self.source / 'theta_basic_lab' / 'unexpected.py').write_text('raise RuntimeError("must not execute")')
        result = self.run_stage()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'READONLY_REVIEWED_SUBSET_PASSED\n')
        key, path = self.output.read_text().strip().split('=', 1)
        self.assertEqual(key, 'root')
        staged = Path(path)
        self.assertEqual({str(p.relative_to(staged)) for p in staged.rglob('*') if p.is_file()}, MODULES)
        for relative in MODULES:
            self.assertEqual((staged / relative).read_bytes(), (BUNDLE / relative).read_bytes())
        self.assertEqual(staged.parent, self.runner)

    def test_rejects_source_tampering(self):
        with (self.source / 'theta_basic_lab/providers.py').open('a') as stream:
            stream.write('\n# altered\n')
        self.assert_refused()

    def test_rejects_symlink_module(self):
        target = self.source / 'theta_basic_lab/providers.py'
        body = target.read_bytes()
        outside = self.root / 'providers.py'
        outside.write_bytes(body)
        target.unlink()
        target.symlink_to(outside)
        self.assert_refused()

    def test_rejects_symlink_package(self):
        package = self.source / 'theta_basic_lab'
        moved = self.root / 'moved'
        package.rename(moved)
        package.symlink_to(moved, target_is_directory=True)
        self.assert_refused()

    def test_rejects_missing_module(self):
        (self.source / 'theta_basic_lab/verify_readonly.py').unlink()
        self.assert_refused()

    def test_rejects_reviewed_sha_disagreement(self):
        self.env['REVIEWED_SHA'] = 'b' * 40
        self.assert_refused()

    def test_rejects_unexpected_checked_out_commit(self):
        self.env.update({'GITHUB_SHA': 'b' * 40, 'REVIEWED_SHA': 'b' * 40})
        self.assert_refused()


if __name__ == '__main__':
    unittest.main()
