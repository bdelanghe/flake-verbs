{
  description = "Flake-structure verbs — input usage and upstream drift, via verbspec";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in
    {
      # Mountable as a home-manager module (the claude-token-tools pattern: a
      # committed bun bundle, wrapped). `flake-verbs inputs <root>` etc. Verb
      # runs emit an OTLP span to the local collector when one is listening.
      homeManagerModules.default = { config, lib, pkgs, ... }:
        let cfg = config.programs.flake-verbs;
        in {
          options.programs.flake-verbs.enable =
            lib.mkEnableOption "the flake-verbs CLI (inputs, input-drift)";
          config = lib.mkIf cfg.enable {
            home.packages = [
              (pkgs.writeShellScriptBin "flake-verbs" ''
                exec ${pkgs.bun}/bin/bun run ${./dist/cli.js} "$@"
              '')
            ];
          };
        };

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          # `gh` is a runtime dependency of input-drift, not just a convenience:
          # it is how upstream queries authenticate without this tool handling a
          # token itself.
          packages = [ pkgs.bun pkgs.gh pkgs.nix ];
        };
      });
    };
}
