{
  # `outputs = inputs:` whose body starts on the next line with a use of an
  # input through `inputs.`: that line is a use, not a declaration.
  inputs.parts.url = "github:hercules-ci/flake-parts";
  inputs.dead.url = "github:nix-community/home-manager";
  outputs = inputs:
    inputs.parts.lib.mkFlake { inherit inputs; } {
      systems = [ ];
    };
}
