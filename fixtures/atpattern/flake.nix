{
  inputs = {
    used.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    dead.url = "github:nix-community/home-manager";
    alsodead.url = "github:numtide/flake-utils";
  };
  # `name@{ … }` pattern spilling onto a second line, with the body's only
  # use of `used` on the same line the pattern closes.
  outputs = inputs@{ self, used, dead,
    alsodead }: { thing = used.lib; };
}
