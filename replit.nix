{ pkgs }: {
  deps = [
    pkgs.nodejs_22
    pkgs.nodePackages.pnpm
    pkgs.git
    pkgs.postgresql
  ];
}
