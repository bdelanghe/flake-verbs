{
  inputs = {
    used.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    dead.url = "github:nix-community/home-manager";
    local.url = "path:/tmp/does-not-exist-anywhere";
  };
  outputs = { used, dead, local, ... }: {
    thing = import ./programs/mod.nix { pkgs = used; };
  };
}
