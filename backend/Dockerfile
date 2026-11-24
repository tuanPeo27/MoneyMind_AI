# Build context: ./backend   (docker build -t moneymind-backend backend)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend.csproj ./
RUN dotnet restore backend.csproj
COPY . .
RUN dotnet publish backend.csproj -c Release -o /out --no-restore /p:UseAppHost=false

# One-off job that applies the EF Core migrations (the app itself does not migrate at start-up).
#   docker build --target migrate -t moneymind-migrate backend
# Run it with ConnectionStrings__DefaultConnection set.
FROM build AS migrate
ENV PATH="$PATH:/root/.dotnet/tools"
RUN dotnet tool install --global dotnet-ef
RUN dotnet ef migrations bundle --configuration Release --self-contained -r linux-x64 -o /efbundle --force
ENTRYPOINT ["/bin/sh", "-c", "/efbundle --connection \"$ConnectionStrings__DefaultConnection\""]

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
# The aspnet image ships a non-root user (UID 1654).
USER $APP_UID
ENTRYPOINT ["dotnet", "backend.dll"]
