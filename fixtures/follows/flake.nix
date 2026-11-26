{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    hm.url = "github:nix-community/home-manager";
    # Root-level follows into another input: the lock records ["hm" "nixpkgs"],
    # an input path from the root — not a node name.
    hmpkgs.follows = "hm/nixpkgs";
  };
  outputs = { self, nixpkgs, hm, hmpkgs }: { };
}
