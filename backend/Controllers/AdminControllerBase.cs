using backend.Helpers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>Base for endpoints restricted to administrators.</summary>
[ApiController]
[Authorize(Roles = Roles.Admin)]
public abstract class AdminControllerBase : ControllerBase;
