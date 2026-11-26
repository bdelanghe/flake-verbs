{
  inputs = {
    dx.url = "github:bdelanghe/dx-compose";
  };
  outputs = { self, dx }: {
    homeConfigurations.me = {
      modules = [
        "${dx}/modules/hm.nix"
        # The imported module's option is enabled right here in flake.nix.
        { programs.devcontainers-cli.enable = true; }
      ];
    };
  };
}
