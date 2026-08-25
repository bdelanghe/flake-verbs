{ pkgs }:
{
  # references `used` via the pkgs arg; nothing here touches `dead` or `local`
  value = pkgs.lib or null;
}
