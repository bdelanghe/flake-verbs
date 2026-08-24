{
  description = "Flake-structure verbs — input usage and upstream drift, via verbspec";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in
    {
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
