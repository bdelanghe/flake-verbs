{
  # Inputs declared in dotted form rather than an `inputs = { … }` block.
  inputs.used.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  inputs.dead.url = "github:nix-community/home-manager";
  inputs.dead.inputs.used.follows = "used";
  inputs.alsodead = {
    url = "github:numtide/flake-utils";
  };
  outputs = { self, used, dead, alsodead }: {
    thing = used.lib;
  };
}
