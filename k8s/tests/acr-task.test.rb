# Offline check of the command that ACR passes to /bin/sh after Go template
# rendering and YAML folding. kubectl supplies Go text/template locally.
require 'base64'
require 'open3'
require 'optparse'
require 'shellwords'
require 'tempfile'
require 'yaml'

task = File.read(File.join(__dir__, '..', 'build-app.yaml'))
# kubectl provides Go templates without Sprig. Substitute only the b64enc
# expression, leaving the token used by the task's conditionals unencoded.
template = task.gsub('.Values', '.data').sub('$token | b64enc', '.data.encodedToken')
Tempfile.create('postiz-acr-task') do |file|
  file.write(template)
  file.flush
  [false, true].product([false, true]).each do |upload, latest|
    values = {
      'image' => 'registry.example/app/postiz:v1',
      'latestImage' => 'registry.example/app/postiz:latest',
      'depsImage' => 'registry.example/ops/deps@sha256:' + 'a' * 64,
      'runtimeImage' => 'registry.example/ops/runtime@sha256:' + 'b' * 64,
      'pushLatest' => latest ? 'publish' : 'skip'
    }
    if upload
      values.merge!('sentryToken' => 'test-only', 'encodedToken' => Base64.strict_encode64('test-only'),
                    'sentryRelease' => 'c' * 40, 'sentryOrg' => 'fixture', 'sentryProject' => 'demo')
    end
    inputs = values.map { |key, value| "--from-literal=#{key}=#{value}" }
    yaml, error, status = Open3.capture3('kubectl', '--kubeconfig=/dev/null', 'create',
      'configmap', 'fixture', '--dry-run=client', "-o=go-template-file=#{file.path}", *inputs)
    raise error unless status.success?
    rendered = YAML.safe_load(yaml)
    build, push = rendered.fetch('steps')
    command = build.fetch('build')
    raise 'build split across shell commands' if command.include?("\n")
    args, tags, secrets = [], [], []
    dockerfile = nil
    context = OptionParser.new do |options|
      options.on('-f FILE') { |value| dockerfile = value }
      options.on('-t TAG') { |value| tags << value }
      options.on('--build-arg ARG') { |value| args << value }
      options.on('--secret SPEC') { |value| secrets << value }
    end.parse(Shellwords.split(command))
    raise 'incorrect Dockerfile or build context' unless dockerfile == 'k8s/Dockerfile' && context == ['.']

    expected_args = ["DEPS_IMAGE=#{values['depsImage']}", "RUNTIME_DEPS_IMAGE=#{values['runtimeImage']}"]
    if upload
      expected_args.concat(['SENTRY_UPLOAD=1', "SENTRY_RELEASE=#{values['sentryRelease']}",
                            'SENTRY_ORG=fixture', 'SENTRY_PROJECT=demo'])
      mount = build.fetch('volumeMounts').fetch(0)
      volume = rendered.fetch('volumes').find { |item| item.fetch('name') == mount.fetch('name') }
      token = volume.fetch('secret').fetch('token')
      raise 'wrong token mounted' unless Base64.strict_decode64(token) == values['sentryToken']
      raise 'wrong build secret' unless secrets == ["id=sentry_token,src=#{mount.fetch('mountPath')}/token"]
    elsif !secrets.empty? || rendered.key?('volumes') || build.key?('volumeMounts')
      raise 'unexpected secret mount'
    end
    raise "unexpected build arguments: #{args}" unless args.sort == expected_args.sort
    expected_tags = [values['image']]
    expected_tags << values['latestImage'] if latest
    raise 'incorrect build targets' unless tags.sort == expected_tags.sort
    raise 'incorrect push targets' unless push.fetch('push').sort == expected_tags.sort
    puts "ACR task passed (upload=#{upload}, latest=#{latest})"
  end
end
